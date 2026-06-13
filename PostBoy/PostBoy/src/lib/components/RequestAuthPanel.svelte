<script lang="ts">
  import { get } from 'svelte/store';
  import { activeTab, updateActiveTab, updateActiveTabBatch } from '$lib/stores/tabStore';
  import { addLog } from '$lib/stores/consoleStore';
  import VariableInput from './VariableInput.svelte';
  import { AUTH_TYPES } from '$lib/auth/types';
  import { updateTabAuthData } from '$lib/auth/tabAuth';
  import {
    buildOAuthAuthorizeUrl,
    fetchOAuth2Token,
    parseOAuthCallbackUrl,
    refreshOAuth2Token,
    type OAuth2TokenResponse,
  } from '$lib/auth/oauth2';
  import type { AuthData } from '$lib/auth/types';
  import { fileOps } from '$lib/api/tauri';
  import { open } from '@tauri-apps/plugin-shell';

  let authType = $derived($activeTab.authType);
  let authData = $derived(($activeTab.authData || {}) as AuthData);
  let collectionId = $derived($activeTab.collectionId);
  let authUsername = $derived($activeTab.authUsername);
  let authPassword = $derived($activeTab.authPassword);
  let authToken = $derived($activeTab.authToken);
  let authApiKey = $derived($activeTab.authApiKey);
  let authApiValue = $derived($activeTab.authApiValue);

  let oauthBusy = $state(false);
  let callbackUrl = $state('');

  function strField(key: string): string {
    const v = authData[key];
    return v == null ? '' : String(v);
  }

  function setAuthField(field: string, value: string | number | boolean | undefined) {
    const tab = get(activeTab);
    const next = updateTabAuthData(tab.authData || {}, field, value);
    const patch: Record<string, unknown> = { authData: next };
    if (field === 'username') patch.authUsername = String(value ?? '');
    if (field === 'password') patch.authPassword = String(value ?? '');
    if (field === 'token') patch.authToken = String(value ?? '');
    if (field === 'key') patch.authApiKey = String(value ?? '');
    if (field === 'value') patch.authApiValue = String(value ?? '');
    if (field === 'accessToken') patch.authToken = String(value ?? '');
    updateActiveTabBatch(patch);
  }

  function onAuthTypeChange(newType: string) {
    updateActiveTabBatch({
      authType: newType,
      authData: {},
      authUsername: '',
      authPassword: '',
      authToken: '',
      authApiKey: '',
      authApiValue: '',
    });
    callbackUrl = '';
  }

  function applyOAuthUpdate(result: OAuth2TokenResponse) {
    const tab = get(activeTab);
    const next = {
      ...(tab.authData || {}),
      accessToken: result.accessToken,
      refreshToken: result.refreshToken ?? strField('refreshToken'),
      tokenType: result.tokenType,
      expiresAt: result.expiresAt,
    };
    updateActiveTabBatch({
      authData: next,
      authToken: result.accessToken,
    });
  }

  async function getOAuthToken() {
    oauthBusy = true;
    try {
      const result = await fetchOAuth2Token(authData as any);
      applyOAuthUpdate(result);
      addLog('✓ OAuth access token retrieved', 'system');
    } catch (e: any) {
      addLog(`✗ OAuth token request failed: ${e.message || e}`, 'error');
    } finally {
      oauthBusy = false;
    }
  }

  async function refreshOAuthToken() {
    oauthBusy = true;
    try {
      const result = await refreshOAuth2Token(authData as any);
      applyOAuthUpdate(result);
      addLog('✓ OAuth token refreshed', 'system');
    } catch (e: any) {
      addLog(`✗ OAuth refresh failed: ${e.message || e}`, 'error');
    } finally {
      oauthBusy = false;
    }
  }

  async function openAuthorizeUrl() {
    const url = buildOAuthAuthorizeUrl(authData as any);
    if (!url) {
      addLog('Authorization URL requires Auth URL and Client ID', 'error');
      return;
    }
    try {
      await open(url);
      addLog('Opened authorization URL in browser', 'system');
    } catch {
      window.open(url, '_blank');
    }
  }

  function parseCallback() {
    const parsed = parseOAuthCallbackUrl(callbackUrl);
    if (parsed.error) {
      addLog(`OAuth error: ${parsed.error}`, 'error');
      return;
    }
    if (!parsed.code) {
      addLog('No authorization code or access token found in callback URL', 'error');
      return;
    }
    const grantType = strField('grantType') || 'authorization_code';
    if (grantType === 'implicit') {
      setAuthField('accessToken', parsed.code);
      addLog('✓ Implicit flow access token captured from callback', 'system');
    } else {
      setAuthField('authCode', parsed.code);
      addLog('✓ Authorization code captured — click Get New Access Token', 'system');
    }
  }

  async function pickAuthFile(field: 'certPath' | 'keyPath' | 'pfxPath', title: string) {
    try {
      const result = await fileOps.showOpenDialog({
        title,
        filters: [{ name: 'Certificates', extensions: ['pem', 'crt', 'cer', 'key', 'p12', 'pfx'] }],
      });
      const filePath = Array.isArray(result) ? result[0] : result;
      if (filePath) setAuthField(field, filePath);
    } catch (e: any) {
      addLog(`File selection failed: ${e.message || e}`, 'error');
    }
  }
</script>

<div class="auth-section">
  <div class="auth-type-selector">
    <label for="auth-type">Type:</label>
    <select
      id="auth-type"
      value={authType}
      onchange={(e) => onAuthTypeChange(e.currentTarget.value)}
      class="auth-type-select"
    >
      {#each AUTH_TYPES as t}
        <option value={t.value}>{t.label}</option>
      {/each}
    </select>
  </div>

  <div class="auth-content">
    {#if authType === 'none'}
      <div class="empty-state">This request does not use any authorization.</div>

    {:else if authType === 'basic'}
      <div class="auth-fields">
        <VariableInput
          value={authUsername}
          {collectionId}
          oninput={(v) => { updateActiveTab('authUsername', v); setAuthField('username', v); }}
          inputClass="auth-input"
          placeholder="Username"
        />
        <VariableInput
          type="password"
          value={authPassword}
          {collectionId}
          oninput={(v) => { updateActiveTab('authPassword', v); setAuthField('password', v); }}
          inputClass="auth-input"
          placeholder="Password"
        />
      </div>

    {:else if authType === 'bearer'}
      <VariableInput
        fieldKey="token"
        value={authToken}
        {collectionId}
        oninput={(v) => { updateActiveTab('authToken', v); setAuthField('token', v); }}
        inputClass="auth-input"
        placeholder={'Token (e.g. {{accessToken}})'}
      />

    {:else if authType === 'api-key'}
      <div class="auth-fields">
        <VariableInput
          value={authApiKey}
          {collectionId}
          oninput={(v) => { updateActiveTab('authApiKey', v); setAuthField('key', v); }}
          inputClass="auth-input"
          placeholder="Key"
        />
        <VariableInput
          fieldKey="value"
          sensitive
          value={authApiValue}
          {collectionId}
          oninput={(v) => { updateActiveTab('authApiValue', v); setAuthField('value', v); }}
          inputClass="auth-input"
          placeholder="Value"
        />
        <div class="auth-field">
          <label for="api-key-add-to">Add to</label>
          <select
            id="api-key-add-to"
            class="auth-type-select"
            value={strField('addTo') || 'header'}
            onchange={(e) => setAuthField('addTo', e.currentTarget.value)}
          >
            <option value="header">Header</option>
            <option value="query">Query Params</option>
          </select>
        </div>
      </div>

    {:else if authType === 'digest'}
      <div class="auth-fields">
        <VariableInput value={strField('username')} {collectionId} oninput={(v) => setAuthField('username', v)} inputClass="auth-input" placeholder="Username" />
        <VariableInput type="password" value={strField('password')} {collectionId} oninput={(v) => setAuthField('password', v)} inputClass="auth-input" placeholder="Password" />
        <VariableInput value={strField('realm')} {collectionId} oninput={(v) => setAuthField('realm', v)} inputClass="auth-input" placeholder="Realm (optional)" />
        <VariableInput value={strField('nonce')} {collectionId} oninput={(v) => setAuthField('nonce', v)} inputClass="auth-input" placeholder="Nonce (optional, auto-generated if empty)" />
        <VariableInput value={strField('opaque')} {collectionId} oninput={(v) => setAuthField('opaque', v)} inputClass="auth-input" placeholder="Opaque (optional)" />
        <p class="auth-hint">Digest uses preemptive MD5 auth. Server challenge/response (401) is not yet supported.</p>
      </div>

    {:else if authType === 'oauth2'}
      <div class="auth-fields">
        <div class="auth-field">
          <label for="oauth-grant">Grant type</label>
          <select id="oauth-grant" class="auth-type-select" value={strField('grantType') || 'client_credentials'} onchange={(e) => setAuthField('grantType', e.currentTarget.value)}>
            <option value="client_credentials">Client Credentials</option>
            <option value="password">Password</option>
            <option value="authorization_code">Authorization Code</option>
            <option value="implicit">Implicit</option>
          </select>
        </div>
        <VariableInput value={strField('accessTokenUrl')} {collectionId} oninput={(v) => setAuthField('accessTokenUrl', v)} inputClass="auth-input" placeholder="Access Token URL" />
        <VariableInput value={strField('authUrl')} {collectionId} oninput={(v) => setAuthField('authUrl', v)} inputClass="auth-input" placeholder="Auth URL (authorization code / implicit)" />
        <VariableInput value={strField('redirectUri')} {collectionId} oninput={(v) => setAuthField('redirectUri', v)} inputClass="auth-input" placeholder="Callback URL" />
        <VariableInput value={strField('clientId')} {collectionId} oninput={(v) => setAuthField('clientId', v)} inputClass="auth-input" placeholder="Client ID" />
        <VariableInput type="password" value={strField('clientSecret')} {collectionId} oninput={(v) => setAuthField('clientSecret', v)} inputClass="auth-input" placeholder="Client Secret" />
        <VariableInput value={strField('scope')} {collectionId} oninput={(v) => setAuthField('scope', v)} inputClass="auth-input" placeholder="Scope" />
        {#if strField('grantType') === 'password'}
          <VariableInput value={strField('username')} {collectionId} oninput={(v) => setAuthField('username', v)} inputClass="auth-input" placeholder="Username" />
          <VariableInput type="password" value={strField('password')} {collectionId} oninput={(v) => setAuthField('password', v)} inputClass="auth-input" placeholder="Password" />
        {/if}
        {#if strField('grantType') === 'authorization_code'}
          <VariableInput sensitive value={strField('authCode')} {collectionId} oninput={(v) => setAuthField('authCode', v)} inputClass="auth-input" placeholder="Authorization Code" />
        {/if}
        <VariableInput sensitive value={strField('accessToken')} {collectionId} oninput={(v) => setAuthField('accessToken', v)} inputClass="auth-input" placeholder="Access Token (current)" />
        <VariableInput type="password" value={strField('refreshToken')} {collectionId} oninput={(v) => setAuthField('refreshToken', v)} inputClass="auth-input" placeholder="Refresh Token" />
        <div class="auth-field">
          <label for="oauth-add-to">Add token to</label>
          <select id="oauth-add-to" class="auth-type-select" value={strField('addTokenTo') || 'header'} onchange={(e) => setAuthField('addTokenTo', e.currentTarget.value)}>
            <option value="header">Authorization Header</option>
            <option value="query">Query Params</option>
          </select>
        </div>
        <VariableInput value={strField('headerPrefix') || strField('tokenType') || 'Bearer'} {collectionId} oninput={(v) => setAuthField('headerPrefix', v)} inputClass="auth-input" placeholder="Header prefix (default Bearer)" />
        <div class="auth-actions">
          {#if strField('grantType') === 'authorization_code' || strField('grantType') === 'implicit'}
            <button type="button" class="auth-btn" onclick={openAuthorizeUrl}>Get Authorization</button>
          {/if}
          <button type="button" class="auth-btn" disabled={oauthBusy} onclick={getOAuthToken}>Get New Access Token</button>
          {#if strField('refreshToken')}
            <button type="button" class="auth-btn" disabled={oauthBusy} onclick={refreshOAuthToken}>Refresh Token</button>
          {/if}
        </div>
        <div class="auth-field">
          <label for="oauth-callback">Paste callback URL</label>
          <VariableInput id="oauth-callback" value={callbackUrl} {collectionId} oninput={(v) => (callbackUrl = v)} inputClass="auth-input" placeholder="https://redirect?code=..." />
          <button type="button" class="auth-btn" onclick={parseCallback}>Parse Callback</button>
        </div>
      </div>

    {:else if authType === 'aws-sigv4'}
      <div class="auth-fields">
        <VariableInput value={strField('accessKey')} {collectionId} oninput={(v) => setAuthField('accessKey', v)} inputClass="auth-input" placeholder="Access Key ID" />
        <VariableInput type="password" value={strField('secretKey')} {collectionId} oninput={(v) => setAuthField('secretKey', v)} inputClass="auth-input" placeholder="Secret Access Key" />
        <VariableInput sensitive value={strField('sessionToken')} {collectionId} oninput={(v) => setAuthField('sessionToken', v)} inputClass="auth-input" placeholder="Session Token (optional)" />
        <VariableInput value={strField('region') || 'us-east-1'} {collectionId} oninput={(v) => setAuthField('region', v)} inputClass="auth-input" placeholder="AWS Region" />
        <VariableInput value={strField('service') || 'execute-api'} {collectionId} oninput={(v) => setAuthField('service', v)} inputClass="auth-input" placeholder="Service name" />
      </div>

    {:else if authType === 'hawk'}
      <div class="auth-fields">
        <VariableInput value={strField('authId')} {collectionId} oninput={(v) => setAuthField('authId', v)} inputClass="auth-input" placeholder="Hawk Auth ID" />
        <VariableInput type="password" value={strField('authKey')} {collectionId} oninput={(v) => setAuthField('authKey', v)} inputClass="auth-input" placeholder="Hawk Auth Key" />
        <VariableInput value={strField('ext')} {collectionId} oninput={(v) => setAuthField('ext', v)} inputClass="auth-input" placeholder="Ext (optional)" />
      </div>

    {:else if authType === 'ntlm'}
      <div class="auth-fields">
        <VariableInput value={strField('username')} {collectionId} oninput={(v) => setAuthField('username', v)} inputClass="auth-input" placeholder="Username" />
        <VariableInput type="password" value={strField('password')} {collectionId} oninput={(v) => setAuthField('password', v)} inputClass="auth-input" placeholder="Password" />
        <VariableInput value={strField('domain')} {collectionId} oninput={(v) => setAuthField('domain', v)} inputClass="auth-input" placeholder="Domain (optional, e.g. CORP)" />
        <VariableInput value={strField('workstation')} {collectionId} oninput={(v) => setAuthField('workstation', v)} inputClass="auth-input" placeholder="Workstation (optional)" />
        <p class="auth-hint">NTLM uses native libcurl authentication (Type 1/2/3 handshake). Kerberos/SPNEGO is not supported yet.</p>
      </div>

    {:else if authType === 'client-cert'}
      <div class="auth-fields">
        <p class="auth-hint">Provide a PKCS#12 bundle <em>or</em> separate certificate + private key files.</p>
        <div class="auth-field">
          <label>PKCS#12 / PFX (optional)</label>
          <div class="auth-file-row">
            <VariableInput value={strField('pfxPath')} {collectionId} oninput={(v) => setAuthField('pfxPath', v)} inputClass="auth-input" placeholder="/path/to/client.p12" />
            <button type="button" class="auth-btn" onclick={() => pickAuthFile('pfxPath', 'Select PKCS#12 file')}>Browse</button>
          </div>
        </div>
        <div class="auth-field">
          <label>Certificate PEM/CRT</label>
          <div class="auth-file-row">
            <VariableInput value={strField('certPath')} {collectionId} oninput={(v) => setAuthField('certPath', v)} inputClass="auth-input" placeholder="/path/to/client.crt" />
            <button type="button" class="auth-btn" onclick={() => pickAuthFile('certPath', 'Select certificate file')}>Browse</button>
          </div>
        </div>
        <div class="auth-field">
          <label>Private key PEM</label>
          <div class="auth-file-row">
            <VariableInput value={strField('keyPath')} {collectionId} oninput={(v) => setAuthField('keyPath', v)} inputClass="auth-input" placeholder="/path/to/client.key" />
            <button type="button" class="auth-btn" onclick={() => pickAuthFile('keyPath', 'Select private key file')}>Browse</button>
          </div>
        </div>
        <VariableInput type="password" value={strField('passphrase')} {collectionId} oninput={(v) => setAuthField('passphrase', v)} inputClass="auth-input" placeholder="Passphrase (if encrypted key or PFX)" />
      </div>
    {/if}
  </div>
</div>

<style>
  .auth-hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .auth-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .auth-btn {
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .auth-btn:hover:not(:disabled) {
    border-color: var(--accent-color);
  }

  .auth-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .auth-planned p {
    margin: 0 0 0.5rem;
    color: var(--text-primary);
    line-height: 1.5;
  }

  .auth-field label {
    display: block;
    margin-bottom: 0.35rem;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-primary);
  }
</style>
