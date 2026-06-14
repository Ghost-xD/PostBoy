/** Request auth types supported by Ripple (Postman-aligned where possible). */
export const AUTH_TYPES = [
  { value: 'none', label: 'No Auth' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'api-key', label: 'API Key' },
  { value: 'digest', label: 'Digest Auth' },
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'aws-sigv4', label: 'AWS Signature' },
  { value: 'hawk', label: 'Hawk Authentication' },
  { value: 'ntlm', label: 'NTLM Authentication' },
  { value: 'client-cert', label: 'Mutual TLS (Client Certificate)' },
] as const;

export type AuthType = (typeof AUTH_TYPES)[number]['value'];

export interface OAuth2AuthData {
  grantType?: 'client_credentials' | 'password' | 'authorization_code' | 'implicit';
  accessTokenUrl?: string;
  authUrl?: string;
  redirectUri?: string;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  scope?: string;
  state?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: number;
  clientAuth?: 'body' | 'header';
  addTokenTo?: 'header' | 'query';
  headerPrefix?: string;
  queryParamName?: string;
}

export interface DigestAuthData {
  username?: string;
  password?: string;
  realm?: string;
  nonce?: string;
  algorithm?: 'MD5' | 'SHA-256';
  qop?: string;
  opaque?: string;
  nonceCount?: string;
  clientNonce?: string;
}

export interface AwsSigV4AuthData {
  accessKey?: string;
  secretKey?: string;
  sessionToken?: string;
  region?: string;
  service?: string;
  addAuthHeader?: boolean;
}

export interface HawkAuthData {
  authId?: string;
  authKey?: string;
  algorithm?: 'sha256' | 'sha1';
  user?: string;
  ext?: string;
}

export interface ApiKeyAuthData {
  key?: string;
  value?: string;
  addTo?: 'header' | 'query';
}

export interface NtlmAuthData {
  username?: string;
  password?: string;
  domain?: string;
  workstation?: string;
}

export interface ClientCertAuthData {
  certPath?: string;
  keyPath?: string;
  pfxPath?: string;
  passphrase?: string;
}

export type AuthData = Record<string, unknown>;
