import type { OAuth2AuthData } from './types';

export interface OAuth2TokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  expiresAt?: number;
}

export function isOAuthTokenExpired(data: OAuth2AuthData): boolean {
  if (!data.expiresAt) return false;
  return Date.now() >= data.expiresAt - 30_000;
}

export async function fetchOAuth2Token(data: OAuth2AuthData): Promise<OAuth2TokenResponse> {
  const tokenUrl = data.accessTokenUrl?.trim();
  if (!tokenUrl) throw new Error('Access token URL is required');

  const grantType = data.grantType || 'client_credentials';
  const body = new URLSearchParams();
  body.set('grant_type', grantType);

  if (grantType === 'password') {
    if (!data.username?.trim()) throw new Error('Username is required for password grant');
    body.set('username', data.username.trim());
    body.set('password', data.password ?? '');
  } else if (grantType === 'authorization_code') {
    const code = (data as any).code?.trim?.() || (data as any).authCode?.trim?.();
    if (!code) throw new Error('Authorization code is required');
    body.set('code', code);
    if (data.redirectUri?.trim()) body.set('redirect_uri', data.redirectUri.trim());
  }

  if (data.scope?.trim()) body.set('scope', data.scope.trim());

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  const clientAuth = data.clientAuth || 'body';
  if (data.clientId?.trim()) {
    if (clientAuth === 'body') {
      body.set('client_id', data.clientId.trim());
      if (data.clientSecret?.trim()) body.set('client_secret', data.clientSecret.trim());
    } else {
      const creds = btoa(`${data.clientId.trim()}:${data.clientSecret ?? ''}`);
      headers['Authorization'] = `Basic ${creds}`;
    }
  }

  const res = await fetch(tokenUrl, { method: 'POST', headers, body: body.toString() });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Token response is not valid JSON');
  }

  const accessToken = json.access_token;
  if (!accessToken) throw new Error('Token response missing access_token');

  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : undefined;
  return {
    accessToken,
    refreshToken: json.refresh_token,
    tokenType: json.token_type || 'Bearer',
    expiresIn,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

export async function refreshOAuth2Token(data: OAuth2AuthData): Promise<OAuth2TokenResponse> {
  if (!data.refreshToken?.trim()) throw new Error('Refresh token is required');
  const tokenUrl = data.accessTokenUrl?.trim();
  if (!tokenUrl) throw new Error('Access token URL is required');

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', data.refreshToken.trim());
  if (data.clientId?.trim()) body.set('client_id', data.clientId.trim());
  if (data.clientSecret?.trim()) body.set('client_secret', data.clientSecret.trim());

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Refresh failed (${res.status}): ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : undefined;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || data.refreshToken,
    tokenType: json.token_type || data.tokenType || 'Bearer',
    expiresIn,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

export function buildOAuth2Authorization(data: OAuth2AuthData): string | null {
  const token = data.accessToken?.trim();
  if (!token) return null;
  const prefix = data.headerPrefix?.trim() || data.tokenType?.trim() || 'Bearer';
  return `${prefix} ${token}`;
}

export function applyOAuth2ToQuery(url: string, data: OAuth2AuthData): string {
  const token = data.accessToken?.trim();
  if (!token) return url;
  const param = data.queryParamName?.trim() || 'access_token';
  try {
    const u = new URL(url);
    u.searchParams.set(param, token);
    return u.toString();
  } catch {
    return url;
  }
}

/** Parse authorization code from a pasted redirect/callback URL. */
export function parseOAuthCallbackUrl(callbackUrl: string): { code?: string; error?: string } {
  try {
    const u = new URL(callbackUrl.trim());
    const code = u.searchParams.get('code') || undefined;
    const error = u.searchParams.get('error') || undefined;
    if (u.hash?.includes('access_token=')) {
      const params = new URLSearchParams(u.hash.slice(1));
      const token = params.get('access_token');
      if (token) return { code: token };
    }
    return { code, error };
  } catch {
    return {};
  }
}

export function buildOAuthAuthorizeUrl(data: OAuth2AuthData): string | null {
  const authUrl = data.authUrl?.trim();
  const clientId = data.clientId?.trim();
  if (!authUrl || !clientId) return null;
  const u = new URL(authUrl);
  u.searchParams.set('response_type', data.grantType === 'implicit' ? 'token' : 'code');
  u.searchParams.set('client_id', clientId);
  if (data.redirectUri?.trim()) u.searchParams.set('redirect_uri', data.redirectUri.trim());
  if (data.scope?.trim()) u.searchParams.set('scope', data.scope.trim());
  if (data.state?.trim()) u.searchParams.set('state', data.state.trim());
  return u.toString();
}
