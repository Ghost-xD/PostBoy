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
}

export interface ApplyAuthResult {
  headers: Record<string, string>;
  url: string;
  body?: string;
  /** Updated OAuth tokens to persist back on the tab after refresh/fetch. */
  oauthUpdate?: OAuth2TokenResponse;
  warning?: string;
}

function str(value: unknown, collectionId?: number): string {
  const raw = value == null ? '' : String(value);
  return collectionId ? interpolate(raw, collectionId) : raw;
}

function resolveAuthData(data: AuthData, collectionId?: number): AuthData {
  const out: AuthData = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = str(v, collectionId);
    else out[k] = v;
  }
  return out;
}

export async function applyRequestAuth(input: ApplyAuthInput): Promise<ApplyAuthResult> {
  const authType = normalizeAuthType(input.authType);
  const data = resolveAuthData(input.authData, input.collectionId);
  let headers = { ...input.headers };
  let url = input.url;
  let body = input.body;
  let oauthUpdate: OAuth2TokenResponse | undefined;

  switch (authType) {
    case 'none':
      break;

    case 'basic': {
      const username = str(data.username, input.collectionId);
      const password = str(data.password, input.collectionId);
      if (username) {
        headers['Authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
      }
      break;
    }

    case 'bearer': {
      const token = str(data.token, input.collectionId);
      if (token) headers['Authorization'] = `Bearer ${token}`;
      break;
    }

    case 'api-key': {
      const key = str(data.key, input.collectionId);
      const value = str(data.value, input.collectionId);
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
        if (auth) headers['Authorization'] = auth;
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
