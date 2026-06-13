import { interpolate } from '$lib/stores/variableStore';
import { normalizeAuthType, serializeAuthFromTab } from './tabAuth';
import { buildDigestAuthorization, digestRequestUri } from './digest';
import { signAwsRequest } from './awsSigV4';
import { buildHawkAuthorization } from './hawk';
import {
  applyOAuth2ToQuery,
  buildOAuth2Authorization,
  fetchOAuth2Token,
  isOAuthTokenExpired,
  refreshOAuth2Token,
  type OAuth2TokenResponse,
} from './oauth2';
import type { AuthData } from './types';

export interface ApplyAuthInput {
  authType: string;
  authData: AuthData;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  collectionId?: number;
  /** Variables extracted by prior chain steps; overrides static bearer/oauth tokens. */
  chainRuntimeVars?: Record<string, string>;
}

export interface ApplyAuthResult {
  headers: Record<string, string>;
  url: string;
  body?: string;
  /** Updated OAuth tokens to persist back on the tab after refresh/fetch. */
  oauthUpdate?: OAuth2TokenResponse;
  warning?: string;
}

function str(value: unknown, collectionId?: number, overrides?: Record<string, string>): string {
  const raw = value == null ? '' : String(value);
  if (!collectionId && !overrides) return raw;
  return interpolate(raw, collectionId, overrides);
}

function authFieldUsesVariable(raw: unknown): boolean {
  return typeof raw === 'string' && /\{\{[^}]+\}\}/.test(raw);
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(
    (k) => k.toLowerCase() === 'authorization' && headers[k]
  );
}

/** Prefer chain-extracted tokens over a static JWT pasted in the bearer/oauth tab. */
function pickChainAuthToken(
  chainRuntimeVars: Record<string, string>,
  rawToken: unknown
): string | undefined {
  if (authFieldUsesVariable(rawToken)) {
    const name = String(rawToken).match(/\{\{([^}]+)\}\}/)?.[1]?.trim();
    if (name && chainRuntimeVars[name]) return chainRuntimeVars[name];
  }
  for (const key of ['accessToken', 'access_token', 'apiToken', 'api_token', 'token', 'authToken', 'idToken']) {
    if (chainRuntimeVars[key]) return chainRuntimeVars[key];
  }
  return undefined;
}

function resolveAuthData(
  data: AuthData,
  collectionId?: number,
  overrides?: Record<string, string>
): AuthData {
  const out: AuthData = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = str(v, collectionId, overrides);
    else out[k] = v;
  }
  return out;
}

export async function applyRequestAuth(input: ApplyAuthInput): Promise<ApplyAuthResult> {
  const authType = normalizeAuthType(input.authType);
  const data = resolveAuthData(input.authData, input.collectionId, input.chainRuntimeVars);
  let headers = { ...input.headers };
  let url = input.url;
  let body = input.body;
  let oauthUpdate: OAuth2TokenResponse | undefined;

  switch (authType) {
    case 'none':
      break;

    case 'basic': {
      const username = str(data.username, input.collectionId, input.chainRuntimeVars);
      const password = str(data.password, input.collectionId, input.chainRuntimeVars);
      if (username) {
        headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
      }
      break;
    }

    case 'bearer': {
      const rawToken = input.authData.token;
      let token = str(rawToken, input.collectionId, input.chainRuntimeVars);
      if (input.chainRuntimeVars && !authFieldUsesVariable(rawToken)) {
        const chainToken = pickChainAuthToken(input.chainRuntimeVars, rawToken);
        if (chainToken) token = chainToken;
      }
      if (token) {
        const usesVariable = authFieldUsesVariable(rawToken);
        const keepHeaderAuth = hasAuthorizationHeader(input.headers) && !usesVariable;
        if (!keepHeaderAuth) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      }
      break;
    }

    case 'api-key': {
      const key = str(data.key, input.collectionId, input.chainRuntimeVars);
      const value = str(data.value, input.collectionId, input.chainRuntimeVars);
      const addTo = (data.addTo as string) || 'header';
      if (key) {
        if (addTo === 'query') {
          try {
            const u = new URL(url);
            u.searchParams.set(key, value);
            url = u.toString();
          } catch {
            /* keep url */
          }
        } else {
          headers[key] = value;
        }
      }
      break;
    }

    case 'digest': {
      const digestHeader = buildDigestAuthorization(
        input.method,
        digestRequestUri(url),
        data as any
      );
      if (digestHeader) headers['Authorization'] = digestHeader;
      break;
    }

    case 'oauth2': {
      let oauth = { ...data } as any;
      const rawAccessToken = input.authData.accessToken;
      if (input.chainRuntimeVars && !authFieldUsesVariable(rawAccessToken)) {
        const chainToken = pickChainAuthToken(input.chainRuntimeVars, rawAccessToken);
        if (chainToken) oauth.accessToken = chainToken;
      }
      if (!oauth.accessToken || isOAuthTokenExpired(oauth)) {
        try {
          if (oauth.refreshToken && isOAuthTokenExpired(oauth)) {
            oauthUpdate = await refreshOAuth2Token(oauth);
          } else if (oauth.grantType === 'client_credentials' || oauth.grantType === 'password') {
            oauthUpdate = await fetchOAuth2Token(oauth);
          }
          if (oauthUpdate) {
            oauth.accessToken = oauthUpdate.accessToken;
            oauth.refreshToken = oauthUpdate.refreshToken ?? oauth.refreshToken;
            oauth.tokenType = oauthUpdate.tokenType;
            oauth.expiresAt = oauthUpdate.expiresAt;
          }
        } catch (e: any) {
          return {
            headers,
            url,
            body,
            warning: e.message || String(e),
          };
        }
      }
      const addTo = oauth.addTokenTo || 'header';
      if (addTo === 'query') {
        url = applyOAuth2ToQuery(url, oauth);
      } else {
        const auth = buildOAuth2Authorization(oauth);
        if (auth) {
          const usesVariable = authFieldUsesVariable(rawAccessToken);
          const keepHeaderAuth = hasAuthorizationHeader(input.headers) && !usesVariable;
          if (!keepHeaderAuth) {
            headers['Authorization'] = auth;
          }
        }
      }
      break;
    }

    case 'aws-sigv4': {
      const signed = await signAwsRequest(input.method, url, headers, body, data as any);
      if (signed) {
        headers = signed.headers;
        url = signed.url;
      }
      break;
    }

    case 'hawk': {
      const hawkHeader = await buildHawkAuthorization(input.method, url, data as any);
      if (hawkHeader) headers['Authorization'] = hawkHeader;
      break;
    }

    case 'ntlm':
    case 'client-cert':
      // Handled by native libcurl transport in the Rust HTTP client.
      break;

    default:
      break;
  }

  return { headers, url, body, oauthUpdate };
}

/** Apply auth from flat tab fields (backward compatible). */
export async function applyRequestAuthFromTab(
  tab: {
    authType: string;
    authData?: AuthData;
    authUsername: string;
    authPassword: string;
    authToken: string;
    authApiKey: string;
    authApiValue: string;
    collectionId?: number;
  },
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<ApplyAuthResult> {
  const { authType, authData } = serializeAuthFromTab({
    ...tab,
    authData: tab.authData ?? {},
  });
  return applyRequestAuth({
    authType,
    authData,
    method,
    url,
    headers,
    body,
    collectionId: tab.collectionId,
  });
}
