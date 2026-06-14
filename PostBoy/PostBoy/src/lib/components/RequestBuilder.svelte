<script lang="ts">
  import { run, stopPropagation, createBubbler } from 'svelte/legacy';

  const bubble = createBubbler();
  import { onMount, untrack } from 'svelte';
  import { activeTab, updateActiveTab, updateActiveTabBatch, updateTab, activeTabId } from '$lib/stores/tabStore';
  import { get } from 'svelte/store';
  import { activeRequestTab, isSendingRequest, sendingTabIds } from '$lib/stores/uiStore';
  import { addLog } from '$lib/stores/consoleStore';
  import { db, fileOps, http } from '$lib/api/tauri';
  import { getSettingsForRequest } from '$lib/stores/settingsStore';
  import { parseCurlCommand, generateCurlCommand } from '$lib/utils/curlParser';
  import { renderMarkdown } from '$lib/utils/markdownRenderer';
  import { generators, type CodeGenOptions } from '$lib/utils/codeGenerator';
  import { variables, interpolate, interpolateJson, interpolateKeyValues, getAllUnresolvedVariables } from '$lib/stores/variableStore';
  import JsonEditor from './JsonEditor.svelte';
  import VariableInput from './VariableInput.svelte';
  import WebSocketPanel from './WebSocketPanel.svelte';
  import SsePanel from './SsePanel.svelte';
  import MethodSelect from './MethodSelect.svelte';
  import { initWsListeners } from '$lib/stores/wsStore';
  import { initSseListeners } from '$lib/stores/sseStore';
  import { captureCookies, injectCookies } from '$lib/stores/cookieStore';
  import RequestAuthPanel from './RequestAuthPanel.svelte';
  import RequestScriptsPanel from './RequestScriptsPanel.svelte';
  import GrpcPanel from './GrpcPanel.svelte';
  import { applyRequestAuthFromTab } from '$lib/auth/authResolver';
  import { serializeAuthFromTab } from '$lib/auth/tabAuth';
  import { runPreRequestScript, runTestScript } from '$lib/utils/requestScriptRunner';
  import { createScriptVariableContext } from '$lib/utils/scriptVariables';
  import EnvironmentSwitcher from '$lib/components/EnvironmentSwitcher.svelte';
  import { shortcutTitle, SCRIPTS_TAB_SHORTCUT } from '$lib/utils/platform';

  interface Props {
    onHistoryUpdate?: () => Promise<void>;
  }

  let { onHistoryUpdate = async () => {} }: Props = $props();

  // --- Header templates ---
  interface HeaderTemplate {
    name: string;
    headers: Array<{key: string, value: string}>;
  }

  const builtInTemplates: HeaderTemplate[] = [
    { name: 'JSON API', headers: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Accept', value: 'application/json' }] },
    { name: 'Form Post', headers: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }] },
    { name: 'Bearer Auth', headers: [{ key: 'Authorization', value: 'Bearer {{accessToken}}' }] },
  ];

  const COMMON_HEADERS = [
    'Accept',
    'Accept-Encoding',
    'Accept-Language',
    'Authorization',
    'Cache-Control',
    'Content-Type',
    'Cookie',
    'Host',
    'If-Modified-Since',
    'If-None-Match',
    'Origin',
    'Pragma',
    'Referer',
    'User-Agent',
    'X-API-Key',
    'X-Requested-With',
    'X-Correlation-ID',
    'X-Forwarded-For',
  ];

  let customTemplates: HeaderTemplate[] = $state([]);
  let showTemplateDropdown = $state(false);
  let docsMode: 'edit' | 'preview' = $state('edit');

  onMount(async () => {
    initWsListeners();
    initSseListeners();
    try {
      const saved = await db.getSetting('header_templates', null);
      if (saved && saved !== 'null') {
        customTemplates = typeof saved === 'string' ? JSON.parse(saved) : saved;
      }
    } catch { /* ignore */ }
  });

  function applyTemplate(template: HeaderTemplate) {
    const current = headers.filter(h => h.key || h.value);
    updateActiveTab('headers', [...current, ...template.headers, {key: '', value: ''}]);
    showTemplateDropdown = false;
    addLog(`✓ Applied "${template.name}" header template`, 'system');
  }

  async function saveCurrentAsTemplate() {
    const validHeaders = headers.filter(h => h.key);
    if (validHeaders.length === 0) {
      addLog('✗ No headers to save as template', 'error');
      return;
    }
    const name = prompt('Template name:');
    if (!name) return;
    customTemplates = [...customTemplates, { name, headers: validHeaders.map(h => ({ key: h.key, value: h.value })) }];
    await db.setSetting('header_templates', JSON.stringify(customTemplates));
    showTemplateDropdown = false;
    addLog(`✓ Saved template "${name}"`, 'system');
  }

  async function deleteCustomTemplate(index: number) {
    customTemplates = customTemplates.filter((_, i) => i !== index);
    await db.setSetting('header_templates', JSON.stringify(customTemplates));
  }

  // --- cURL export ---
  let curlCopied = $state(false);
  let curlCopiedTimeout: ReturnType<typeof setTimeout> | null = null;

  export async function copyAsCurl() {
    const collectionId = $activeTab.collectionId;
    const resolvedUrl = interpolate(url, collectionId);
    const resolvedHeaders = interpolateKeyValues(headers, collectionId);
    const resolvedBody = bodyType === 'json'
      ? interpolateJson(bodyContent, collectionId)
      : interpolate(bodyContent, collectionId);
    const resolvedAuthToken = interpolate(authToken, collectionId);
    const resolvedAuthUsername = interpolate(authUsername, collectionId);
    const resolvedAuthPassword = interpolate(authPassword, collectionId);
    const resolvedAuthApiKey = interpolate(authApiKey, collectionId);
    const resolvedAuthApiValue = interpolate(authApiValue, collectionId);

    const headersObj: Record<string, string> = {};
    resolvedHeaders.filter((h) => h.key && h.value).forEach((h) => { headersObj[h.key] = h.value; });

    const authResult = await applyRequestAuthFromTab(
      { authType, authData, authUsername: resolvedAuthUsername, authPassword: resolvedAuthPassword,
        authToken: resolvedAuthToken, authApiKey: resolvedAuthApiKey, authApiValue: resolvedAuthApiValue, collectionId },
      method, resolvedUrl, headersObj, resolvedBody || undefined
    );

    const curlCmd = generateCurlCommand({
      method, url: authResult.url, headers: resolvedHeaders, body: resolvedBody, bodyType,
      formDataPairs: bodyType === 'form-data' ? formDataPairs : undefined,
      authType, authToken: resolvedAuthToken, authUsername: resolvedAuthUsername,
      authPassword: resolvedAuthPassword, authApiKey: resolvedAuthApiKey, authApiValue: resolvedAuthApiValue,
      authData, resolvedHeaders: authResult.headers,
    });
    await navigator.clipboard.writeText(curlCmd);
    addLog('✓ Copied as cURL (variables resolved)', 'system');
    curlCopied = true;
    if (curlCopiedTimeout) clearTimeout(curlCopiedTimeout);
    curlCopiedTimeout = setTimeout(() => { curlCopied = false; }, 1500);
  }

  // --- Code generation ---
  export function openCodeGen() { showCodeGenModal = true; }
  export function toggleDocsMode() { docsMode = docsMode === 'edit' ? 'preview' : 'edit'; }
  let showCodeGenModal = $state(false);
  let codeGenLanguage = $state('fetch');

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.parentNode?.removeChild(node); } };
  }

  function getCodeGenOptions(resolvedHeaders?: Record<string, string>, resolvedUrl?: string): CodeGenOptions {
    return {
      method, url: resolvedUrl || url, headers: headers.filter(h => h.key && h.value), body: bodyContent, bodyType,
      authType, authToken, authUsername, authPassword, authApiKey, authApiValue, authData, resolvedHeaders,
    };
  }

  let generatedCode = $state('');
  run(() => {
    if (!showCodeGenModal) { generatedCode = ''; return; }
    void (async () => {
      const headersObj: Record<string, string> = {};
      headers.filter((h) => h.key && h.value).forEach((h) => { headersObj[h.key] = h.value; });
      const authResult = await applyRequestAuthFromTab(
        { authType, authData, authUsername, authPassword, authToken, authApiKey, authApiValue, collectionId },
        method, url, headersObj, bodyContent || undefined
      );
      generatedCode = generators[codeGenLanguage]?.generate(
        getCodeGenOptions(authResult.headers, authResult.url)
      ) || '';
    })();
  });

  async function copyGeneratedCode() {
    await navigator.clipboard.writeText(generatedCode);
    addLog('✓ Copied code snippet', 'system');
  }

  function highlightCode(code: string, lang: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escaped = esc(code);

    const keywords: Record<string, string[]> = {
      javascript: ['const','let','var','async','await','function','return','import','require','new','if','else','true','false','null','undefined','typeof','console'],
      python: ['import','from','def','return','class','if','else','elif','True','False','None','print','async','await','with','as','not','in','and','or'],
      csharp: ['using','var','new','async','await','public','private','static','void','string','int','class','namespace','return','if','else','true','false','null'],
      bash: ['curl'],
    };

    let result = escaped;

    // strings: single and double quoted
    result = result.replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, '<span class="hl-str">$&</span>');

    // comments: // and #
    result = result.replace(/(\/\/.*$|#.*$)/gm, '<span class="hl-cmt">$&</span>');

    // numbers
    result = result.replace(/\b(\d+)\b/g, '<span class="hl-num">$1</span>');

    // keywords
    const kws = keywords[lang] || keywords['javascript'] || [];
    if (kws.length > 0) {
      const kwPattern = new RegExp(`\\b(${kws.join('|')})\\b`, 'g');
      result = result.replace(kwPattern, (match) => {
        if (result.indexOf(`<span class="hl-str">${match}`) > -1) return match;
        return `<span class="hl-kw">${match}</span>`;
      });
    }

    // flags like -X, -H, -d, -u, --header
    if (lang === 'bash') {
      result = result.replace(/(\s)(--?\w[\w-]*)/g, '$1<span class="hl-flag">$2</span>');
    }

    return result;
  }

  let highlightedCode = $derived(showCodeGenModal ? highlightCode(generatedCode, generators[codeGenLanguage]?.language || 'javascript') : '');

  // --- Auto-format ---
  export function formatBody() {
    if (bodyType === 'json') {
      updateActiveTab('bodyContent', formatJson(bodyContent));
    } else if (bodyType === 'xml' || bodyType === 'html') {
      updateActiveTab('bodyContent', formatXml(bodyContent));
    }
  }

  function formatXml(text: string): string {
    if (!text.trim()) return text;
    try {
      let formatted = '';
      let indent = 0;
      const tokens = text.replace(/>\s*</g, '><').split(/(<[^>]+>)/);
      for (const token of tokens) {
        const trimmed = token.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('</')) {
          indent = Math.max(0, indent - 1);
          formatted += '  '.repeat(indent) + trimmed + '\n';
        } else if (trimmed.startsWith('<') && !trimmed.startsWith('<?') && !trimmed.endsWith('/>') && !trimmed.includes('</')) {
          formatted += '  '.repeat(indent) + trimmed + '\n';
          indent++;
        } else {
          formatted += '  '.repeat(indent) + trimmed + '\n';
        }
      }
      return formatted.trim();
    } catch {
      return text;
    }
  }

  let isCurrentTabSending = $derived($sendingTabIds.has($activeTab.id));

  // Reactive getters from active tab
  let method = $derived($activeTab.method);
  let isWsMethod = $derived(method === 'WS' || method === 'WSS');
  let isSseMethod = $derived(method === 'SSE');
  let isGrpcMethod = $derived(method === 'GRPC');
  let preRequestScript = $derived($activeTab.preRequestScript || '');
  let testScript = $derived($activeTab.testScript || '');

  let url = $derived($activeTab.url);
  let params = $derived($activeTab.params);
  let headers = $derived($activeTab.headers);
  let bodyType = $derived($activeTab.bodyType);
  let bodyContent = $derived($activeTab.bodyContent);
  let formDataPairs = $derived($activeTab.formDataPairs);
  let formUrlencodedPairs = $derived($activeTab.formUrlencodedPairs);
  let graphqlQuery = $derived($activeTab.graphqlQuery);
  let graphqlVariables = $derived($activeTab.graphqlVariables);
  let binaryFileName = $derived($activeTab.binaryFileName);
  let binaryFilePath = $derived($activeTab.binaryFilePath);
  let binaryFileSize = $derived($activeTab.binaryFileSize);
  let authType = $derived($activeTab.authType);
  let authUsername = $derived($activeTab.authUsername);
  let authPassword = $derived($activeTab.authPassword);
  let authToken = $derived($activeTab.authToken);
  let authApiKey = $derived($activeTab.authApiKey);
  let authApiValue = $derived($activeTab.authApiValue);
  let authData = $derived($activeTab.authData || {});
  let collectionId = $derived($activeTab.collectionId);

  // Local body content for JsonEditor two-way binding.
  // Persist only tracks localBodyContent — not activeTabId — so tab switches load
  // from the store first instead of writing stale editor text into the new tab.
  let localBodyContent = $state('');
  run(() => {
    localBodyContent = bodyContent;
  });
  run(() => {
    const content = localBodyContent;
    untrack(() => {
      if (content !== bodyContent) {
        updateActiveTab('bodyContent', content);
      }
    });
  });

  function handleUrlValue(rawValue: string) {
    const value = rawValue.trim();
    
    if (!value) {
      updateActiveTabBatch({
        method: 'GET',
        url: '',
        headers: [{key: '', value: ''}],
        params: [{key: '', value: ''}],
        bodyContent: '',
        bodyType: 'json',
        formDataPairs: [{key: '', value: '', type: 'text'}],
        formUrlencodedPairs: [{key: '', value: ''}],
        graphqlQuery: '',
        graphqlVariables: '',
        binaryFileName: '',
        binaryFileSize: '',
        authType: 'none',
        authUsername: '',
        authPassword: '',
        authToken: '',
        authApiKey: '',
        authApiValue: '',
        authData: {},
        responseStatus: null,
        responseStatusText: '',
        responseTime: null,
        responseHeaders: {},
        responseBody: '',
        responseSize: '',
        responseTimestamp: ''
      });
      addLog('Form cleared', 'system');
      return;
    }
    
    if (value.toLowerCase().startsWith('curl ')) {
      const parsed = parseCurlCommand(value);
      if (parsed) {
        const parsedHeaders = Object.entries(parsed.headers).map(([k, v]) => ({ key: k, value: v }));
        
        let parsedParams: Array<{key: string, value: string}> = [{key: '', value: ''}];
        try {
          const urlObj = new URL(parsed.url);
          const urlParams: Array<{key: string, value: string}> = [];
          urlObj.searchParams.forEach((v, k) => urlParams.push({ key: k, value: v }));
          if (urlParams.length > 0) parsedParams = urlParams;
        } catch { /* ignore */ }
        
        let detectedBodyType = 'json';
        if (parsed.formFields?.length) {
          detectedBodyType = 'form-data';
        } else if (parsed.body) {
          const contentType = parsed.headers['Content-Type'] || parsed.headers['content-type'] || '';
          if (contentType.includes('application/x-www-form-urlencoded')) {
            detectedBodyType = 'form-urlencoded';
          } else if (contentType.includes('multipart/form-data')) {
            detectedBodyType = 'form-data';
          } else if (contentType.includes('text/plain')) {
            detectedBodyType = 'text';
          } else if (contentType.includes('text/xml') || contentType.includes('application/xml')) {
            detectedBodyType = 'xml';
          }
        }

        const tabName = parsed.url.split('?')[0].split('/').filter(Boolean).pop() || `${parsed.method} Request`;

        const batch: Record<string, any> = {
          name: tabName,
          method: parsed.method,
          url: parsed.url,
          headers: parsedHeaders.length > 0 ? parsedHeaders : [{key: '', value: ''}],
          params: parsedParams,
          bodyType: detectedBodyType,
          bodyContent: parsed.body ? String(parsed.body) : ''
        };

        if (parsed.formFields?.length) {
          batch.formDataPairs = parsed.formFields.map(f => ({
            key: f.key, value: f.value, type: f.type, fileName: f.fileName
          }));
        }

        updateActiveTabBatch(batch);
        
        if (parsed.body) {
          activeRequestTab.set('body');
          addLog(`✓ Parsed curl: ${parsed.method} ${parsed.url} (${Object.keys(parsed.headers).length} headers, body)`, 'system');
        } else {
          addLog(`✓ Parsed curl: ${parsed.method} ${parsed.url} (${Object.keys(parsed.headers).length} headers)`, 'system');
        }
      } else {
        addLog('✗ Failed to parse curl command', 'system');
      }
    } else {
      updateActiveTab('url', value);
      parseUrlParams(value);
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData('text') || '';
    if (pasted.trim().toLowerCase().startsWith('curl ')) {
      e.preventDefault();
      handleUrlValue(pasted);
    }
  }

  function parseUrlParams(urlValue: string) {
    if (!urlValue) return;
    
    try {
      const urlObj = new URL(urlValue);
      const newParams: Array<{key: string, value: string}> = [];
      urlObj.searchParams.forEach((value, key) => {
        newParams.push({ key, value });
      });
      if (newParams.length > 0) {
        newParams.push({key: '', value: ''});
        updateActiveTab('params', newParams);
      }
    } catch { /* not a valid URL yet */ }
  }

  async function sendRequest() {
    const currentUrl = url.trim();
    
    if (!currentUrl) {
      addLog('✗ URL is required', 'error');
      return;
    }

    const sendingTabId = get(activeTabId);
    sendingTabIds.update(s => { s.add(sendingTabId); return new Set(s); });
    isSendingRequest.set(true);
    updateTab(sendingTabId, {
      responseStatus: null,
      responseBody: '',
      responseHeaders: {}
    });
    
    const startTime = Date.now();
    const collectionId = $activeTab.collectionId;

    if (!collectionId) {
      addLog('⚠ No collection linked — variables like {{accessToken}} won\'t be resolved. Re-open this request from a collection.', 'error');
    }

    if (collectionId) {
      await variables.load(collectionId);
    }
    
    // Check for unresolved variables before sending
    const textsToCheck = [
      currentUrl,
      ...params.map(p => p.key), ...params.map(p => p.value),
      ...headers.map(h => h.key), ...headers.map(h => h.value),
      bodyContent, authToken, authUsername, authPassword, authApiKey, authApiValue,
      ...Object.values(authData).filter(v => typeof v === 'string')
    ];
    const unresolved = getAllUnresolvedVariables(textsToCheck, collectionId);
    if (unresolved.length > 0) {
      addLog(`⚠ Unresolved variables: {{${unresolved.join('}}, {{')}}}`, 'error');
    }
    
    // Interpolate URL with variables
    const resolvedUrl = interpolate(currentUrl, collectionId);
    addLog(`⏳ Sending ${method} request to ${resolvedUrl}...`, 'info');

    try {
      let requestUrl = resolvedUrl;
      
      // Interpolate params
      const resolvedParams = interpolateKeyValues(params, collectionId);
      const validParams = resolvedParams.filter(p => p.key && p.value);
      if (validParams.length > 0) {
        // Params tab is the source of truth: strip any existing query string
        // from the URL since parseUrlParams() already mirrored it into params.
        // Without this, params would be sent twice (server sees them as arrays).
        const qIdx = requestUrl.indexOf('?');
        if (qIdx >= 0) requestUrl = requestUrl.slice(0, qIdx);
        const urlParams = new URLSearchParams();
        validParams.forEach(p => urlParams.append(p.key, p.value));
        requestUrl += '?' + urlParams.toString();
      }

      // Interpolate headers
      const resolvedHeaders = interpolateKeyValues(headers, collectionId);
      const headersObj: Record<string, string> = {};
      resolvedHeaders.filter(h => h.key && h.value).forEach(h => {
        headersObj[h.key] = h.value;
      });

      let requestBody: string | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        if (bodyType === 'form-urlencoded') {
          const resolvedPairs = interpolateKeyValues(formUrlencodedPairs, collectionId);
          const pairs = resolvedPairs.filter(p => p.key);
          if (pairs.length > 0) {
            const urlParams = new URLSearchParams();
            pairs.forEach(p => urlParams.append(p.key, p.value));
            requestBody = urlParams.toString();
          }
        } else if (bodyType === 'form-data') {
          const textPairs = formDataPairs.filter(p => p.type === 'text' && p.key);
          const filePairs = formDataPairs.filter(p => p.type === 'file' && p.key && p.value);
          const resolvedTextPairs = interpolateKeyValues(
            textPairs.map(p => ({ key: p.key, value: p.value })),
            collectionId
          ).filter(p => p.key);

          if (resolvedTextPairs.length > 0 || filePairs.length > 0) {
            const boundary = '----RippleFormBoundary' + Date.now();
            let body = '';
            resolvedTextPairs.forEach(p => {
              body += `--${boundary}\r\nContent-Disposition: form-data; name="${p.key}"\r\n\r\n${p.value}\r\n`;
            });

            for (const fp of filePairs) {
              try {
                const fileData = await fileOps.readFileBase64(fp.value);
                const fileName = fp.fileName || fileData.name;
                body += `--${boundary}\r\nContent-Disposition: form-data; name="${fp.key}"; filename="${fileName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${fileData.base64}\r\n`;
              } catch (e: any) {
                addLog(`Failed to read file ${fp.value}: ${e.message || e}`, 'error');
              }
            }

            body += `--${boundary}--\r\n`;
            requestBody = body;
            headersObj['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
          }
        } else if (bodyType === 'graphql') {
          const resolvedQuery = interpolate(graphqlQuery, collectionId);
          const resolvedVars = interpolate(graphqlVariables, collectionId);
          if (resolvedQuery) {
            let variables = {};
            try { variables = resolvedVars ? JSON.parse(resolvedVars) : {}; } catch { /* skip */ }
            requestBody = JSON.stringify({ query: resolvedQuery, variables });
          }
        } else if (bodyType === 'binary' && binaryFilePath) {
          try {
            const fileData = await fileOps.readFileBase64(binaryFilePath);
            requestBody = fileData.base64;
            if (!headersObj['Content-Type']) {
              headersObj['Content-Type'] = 'application/octet-stream';
            }
            headersObj['Content-Transfer-Encoding'] = 'base64';
          } catch (e: any) {
            addLog(`Failed to read binary file: ${e.message || e}`, 'error');
          }
        } else if (bodyType !== 'none' && bodyType !== 'binary' && bodyContent) {
          // JSON bodies escape interpolated values so a value containing quotes,
          // backslashes or newlines can't produce malformed JSON.
          requestBody = bodyType === 'json'
            ? interpolateJson(bodyContent, collectionId)
            : interpolate(bodyContent, collectionId);
        }
      }

      if (requestBody && !headersObj['Content-Type']) {
        if (bodyType === 'json' || bodyType === 'graphql') {
          headersObj['Content-Type'] = 'application/json';
        } else if (bodyType === 'xml') {
          headersObj['Content-Type'] = 'application/xml';
        } else if (bodyType === 'form-urlencoded') {
          headersObj['Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (bodyType === 'yaml') {
          headersObj['Content-Type'] = 'application/x-yaml';
        } else if (bodyType === 'html') {
          headersObj['Content-Type'] = 'text/html';
        } else if (bodyType === 'javascript') {
          headersObj['Content-Type'] = 'application/javascript';
        } else if (bodyType === 'text') {
          headersObj['Content-Type'] = 'text/plain';
        }
      }

      // Pre-request script (can mutate url, headers, body)
      if (preRequestScript.trim()) {
        const scriptResult = await runPreRequestScript(
          preRequestScript,
          { method, url: requestUrl, headers: headersObj, body: requestBody },
          createScriptVariableContext(collectionId),
          collectionId
        );
        for (const line of scriptResult.logs) addLog(`[script] ${line}`, 'info');
        for (const err of scriptResult.errors) addLog(`[script] ${err}`, 'error');
        if (scriptResult.errors.length) {
          addLog('Pre-request script failed — aborting send', 'error');
          return;
        }
        requestUrl = scriptResult.request.url;
        Object.assign(headersObj, scriptResult.request.headers);
        requestBody = scriptResult.request.body;
      }

      // Apply auth after body is built (AWS Sig V4 signs payload hash)
      const authResult = await applyRequestAuthFromTab(
        {
          authType,
          authData,
          authUsername,
          authPassword,
          authToken,
          authApiKey,
          authApiValue,
          collectionId,
        },
        method,
        requestUrl,
        headersObj,
        requestBody
      );
      if (authResult.warning) {
        addLog(`⚠ Auth: ${authResult.warning}`, 'error');
      }
      Object.assign(headersObj, authResult.headers);
      requestUrl = authResult.url;
      requestBody = authResult.body;
      if (authResult.oauthUpdate) {
        updateTab(sendingTabId, {
          authData: {
            ...authData,
            accessToken: authResult.oauthUpdate.accessToken,
            refreshToken: authResult.oauthUpdate.refreshToken ?? (authData as any).refreshToken,
            tokenType: authResult.oauthUpdate.tokenType,
            expiresAt: authResult.oauthUpdate.expiresAt,
          },
          authToken: authResult.oauthUpdate.accessToken,
        });
      }

      if (collectionId && !headersObj['Cookie']) {
        const cookieHeader = await injectCookies(collectionId, requestUrl);
        if (cookieHeader) {
          headersObj['Cookie'] = cookieHeader;
        }
      }

      const reqSettings = getSettingsForRequest();
      const { authType: nativeAuthType, authData: nativeAuthData } = serializeAuthFromTab({
        authType,
        authData,
        authUsername,
        authPassword,
        authToken,
        authApiKey,
        authApiValue,
      });
      const response: any = await http.executeRequest(
        method,
        requestUrl,
        Object.keys(headersObj).length > 0 ? headersObj : undefined,
        requestBody,
        {
          ...reqSettings,
          authType: nativeAuthType,
          authData: nativeAuthData,
        }
      );

      const responseTime = response.responseTime || (Date.now() - startTime);
      const sizeBytes = new Blob([response.body || '']).size;
      const responseSize = sizeBytes < 1024 ? `${sizeBytes} B` : `${(sizeBytes / 1024).toFixed(1)} KB`;

      updateTab(sendingTabId, {
        responseStatus: response.status,
        responseStatusText: response.statusText || 'OK',
        responseTime,
        responseHeaders: response.headers || {},
        responseBody: response.body || '',
        responseContentType: response.contentType || '',
        responseIsBinary: response.isBinary || false,
        responseSize,
        responseTimestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })
      });

      addLog(`✓ ${response.status} ${response.statusText || 'OK'} • ${responseTime}ms • ${responseSize}`, 'info');

      if (testScript.trim()) {
        const testResult = await runTestScript(
          testScript,
          { method, url: requestUrl, headers: headersObj, body: requestBody },
          {
            status: response.status,
            statusText: response.statusText || 'OK',
            headers: response.headers || {},
            body: response.body || '',
            responseTime,
          },
          createScriptVariableContext(collectionId),
          collectionId
        );
        for (const line of testResult.logs) addLog(`[test] ${line}`, 'info');
        for (const err of testResult.errors) addLog(`[test] ${err}`, 'error');
        for (const t of testResult.testResults) {
          addLog(t.passed ? `✓ ${t.name}` : `✗ ${t.name}${t.error ? `: ${t.error}` : ''}`, t.passed ? 'info' : 'error');
        }
      }

      if (collectionId && response.headers) {
        const headerEntries = Object.entries(response.headers) as Array<[string, string]>;
        await captureCookies(collectionId, headerEntries, requestUrl);
      }

      const { authType: savedAuthType, authData: savedAuthData } = serializeAuthFromTab({
        authType,
        authData,
        authUsername,
        authPassword,
        authToken,
        authApiKey,
        authApiValue,
      });

      await db.addHistory(
        {
          method,
          url: requestUrl,
          headers: headersObj,
          params: validParams,
          bodyType,
          bodyContent,
          authType: savedAuthType,
          authData: savedAuthData,
        },
        { status: response.status, responseTime, headers: response.headers || {}, body: response.body }
      );

      await onHistoryUpdate();
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      updateTab(sendingTabId, {
        responseStatus: 0,
        responseStatusText: 'Error',
        responseTime,
        responseBody: `Error: ${error.message || error}`,
        responseSize: '',
        responseTimestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })
      });
      addLog(`✗ Request failed: ${error.message || error}`, 'error');
    } finally {
      sendingTabIds.update(s => { s.delete(sendingTabId); return new Set(s); });
      isSendingRequest.set(get(sendingTabIds).size > 0);
    }
  }

  function addParam() {
    updateActiveTab('params', [...params, {key: '', value: ''}]);
  }

  function removeParam(index: number) {
    const newParams = params.filter((_, i) => i !== index);
    updateActiveTab('params', newParams.length > 0 ? newParams : [{key: '', value: ''}]);
  }

  function addHeader() {
    updateActiveTab('headers', [...headers, {key: '', value: ''}]);
  }

  function removeHeader(index: number) {
    const newHeaders = headers.filter((_, i) => i !== index);
    updateActiveTab('headers', newHeaders.length > 0 ? newHeaders : [{key: '', value: ''}]);
  }

  function addFormDataPair() {
    updateActiveTab('formDataPairs', [...formDataPairs, {key: '', value: '', type: 'text'}]);
  }

  function removeFormDataPair(index: number) {
    const newPairs = formDataPairs.filter((_, i) => i !== index);
    updateActiveTab('formDataPairs', newPairs.length > 0 ? newPairs : [{key: '', value: '', type: 'text'}]);
  }

  function addFormUrlencodedPair() {
    updateActiveTab('formUrlencodedPairs', [...formUrlencodedPairs, {key: '', value: ''}]);
  }

  function removeFormUrlencodedPair(index: number) {
    const newPairs = formUrlencodedPairs.filter((_, i) => i !== index);
    updateActiveTab('formUrlencodedPairs', newPairs.length > 0 ? newPairs : [{key: '', value: ''}]);
  }

  async function selectBinaryFile() {
    try {
      const result = await fileOps.showOpenDialog({ title: 'Select File' });
      const filePath = Array.isArray(result) ? result[0] : result;
      if (filePath) {
        const parts = filePath.replace(/\\/g, '/').split('/');
        updateActiveTabBatch({
          binaryFileName: parts[parts.length - 1],
          binaryFilePath: filePath,
          binaryFileSize: ''
        });
        addLog(`Selected file: ${parts[parts.length - 1]}`, 'system');
      }
    } catch (error: any) {
      console.error('File selection failed:', error);
    }
  }

  function clearBinaryFile() {
    updateActiveTabBatch({
      binaryFileName: '',
      binaryFilePath: '',
      binaryFileSize: ''
    });
  }

  async function selectFormDataFile(index: number) {
    try {
      const result = await fileOps.showOpenDialog({ title: 'Select File' });
      const filePath = Array.isArray(result) ? result[0] : result;
      if (filePath) {
        const parts = filePath.replace(/\\/g, '/').split('/');
        const newPairs = [...formDataPairs];
        newPairs[index] = { ...newPairs[index], value: filePath, fileName: parts[parts.length - 1] };
        updateActiveTab('formDataPairs', newPairs);
      }
    } catch (error: any) {
      console.error('File selection failed:', error);
    }
  }

  function formatJson(text: string) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  function updateParam(index: number, field: 'key' | 'value', value: string) {
    const newParams = [...params];
    newParams[index] = { ...newParams[index], [field]: value };
    updateActiveTab('params', newParams);
  }

  function updateHeader(index: number, field: 'key' | 'value', value: string) {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    updateActiveTab('headers', newHeaders);
  }

  function updateFormDataPair(index: number, field: 'key' | 'value' | 'type', value: string) {
    const newPairs = [...formDataPairs];
    newPairs[index] = { ...newPairs[index], [field]: value } as any;
    updateActiveTab('formDataPairs', newPairs);
  }

  function updateFormUrlencodedPair(index: number, field: 'key' | 'value', value: string) {
    const newPairs = [...formUrlencodedPairs];
    newPairs[index] = { ...newPairs[index], [field]: value };
    updateActiveTab('formUrlencodedPairs', newPairs);
  }
</script>

<div class="request-section">
  <div class="request-bar">
    <div class="request-bar-inner">
      <MethodSelect value={method} onValueChange={(v) => updateActiveTab('method', v)} />
      <div class="url-divider"></div>
      <VariableInput
        id="url-input"
        value={url}
        {collectionId}
        oninput={handleUrlValue}
        onpaste={handlePaste}
        inputClass="url-input"
        placeholder={isWsMethod ? 'Enter WebSocket URL (ws:// or wss://)' : isSseMethod ? 'Enter SSE endpoint URL' : isGrpcMethod ? 'Enter gRPC server (grpcb.in:9000)' : 'Enter request URL or paste curl command'}
        onkeypress={(e) => e.key === 'Enter' && !isWsMethod && !isSseMethod && !isGrpcMethod && sendRequest()}
      />
      <div class="bar-actions">
        <button class="action-icon-btn {curlCopied ? 'copied' : ''}" onclick={copyAsCurl} title="Copy as cURL (Ctrl+Shift+K)">
          {#if curlCopied}
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
          {:else}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.912 4.895 3 6 3h8c1.105 0 2 .912 2 2.036v1.866"/><rect x="8" y="7" width="12" height="14" rx="2"/></svg>
          {/if}
        </button>
        <button class="action-icon-btn" onclick={() => showCodeGenModal = true} title="Generate Code (Ctrl+Shift+G)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </button>
      </div>
    </div>
    <EnvironmentSwitcher />
    {#if !isWsMethod && !isSseMethod && !isGrpcMethod}
    <button id="send-btn" onclick={sendRequest} class="send-btn" disabled={isCurrentTabSending} title={shortcutTitle('Send Request', 'Ctrl+Enter')}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      {isCurrentTabSending ? 'Sending...' : 'Send'}
    </button>
    {/if}
  </div>

  {#if isWsMethod}
    <div class="ws-panel-wrapper">
      <WebSocketPanel />
    </div>
  {:else if isSseMethod}
    <div class="ws-panel-wrapper">
      <SsePanel />
    </div>
  {:else if isGrpcMethod}
    <div class="ws-panel-wrapper">
      <GrpcPanel />
    </div>
  {:else}
  <div class="request-tabs">
    <button 
      class="tab-btn {$activeRequestTab === 'params' ? 'active' : ''}" 
      onclick={() => activeRequestTab.set('params')}
      title={shortcutTitle('Params', 'Ctrl+P')}
    >
      Params
      <span class="tab-count">{params.filter(p => p.key).length}</span>
    </button>
    <button 
      class="tab-btn {$activeRequestTab === 'body' ? 'active' : ''}"
      onclick={() => activeRequestTab.set('body')}
      title={shortcutTitle('Body', 'Ctrl+B')}
    >
      Body
    </button>
    <button 
      class="tab-btn {$activeRequestTab === 'auth' ? 'active' : ''}"
      onclick={() => activeRequestTab.set('auth')}
      title={shortcutTitle('Authorization', 'Ctrl+Shift+A')}
    >
      Authorization
    </button>
    <button 
      class="tab-btn {$activeRequestTab === 'headers' ? 'active' : ''}"
      onclick={() => activeRequestTab.set('headers')}
      title={shortcutTitle('Headers', 'Ctrl+H')}
    >
      Headers
      <span class="tab-count">{headers.filter(h => h.key).length}</span>
    </button>
    <button
      class="tab-btn {$activeRequestTab === 'scripts' ? 'active' : ''}"
      onclick={() => activeRequestTab.set('scripts')}
      title={shortcutTitle('Scripts', SCRIPTS_TAB_SHORTCUT)}
    >
      Scripts
    </button>
    <button
      class="tab-btn {$activeRequestTab === 'docs' ? 'active' : ''}"
      onclick={() => activeRequestTab.set('docs')}
      title={shortcutTitle('Documentation', 'Ctrl+D')}
    >
      Docs
      {#if $activeTab.description}<span class="tab-dot"></span>{/if}
    </button>
  </div>

  <div class="tab-content">
    <div id="params-tab" class="tab-pane {$activeRequestTab === 'params' ? 'active' : ''}">
      <div class="key-value-pairs" id="params-container">
        {#each params as param, i}
          <div class="key-value-row">
            <VariableInput
              value={param.key}
              {collectionId}
              oninput={(v) => updateParam(i, 'key', v)}
              inputClass="key-input"
              placeholder="Key"
            />
            <VariableInput
              value={param.value}
              fieldKey={param.key}
              {collectionId}
              oninput={(v) => updateParam(i, 'value', v)}
              inputClass="value-input"
              placeholder="Value"
            />
            <button class="remove-btn" onclick={() => removeParam(i)}>×</button>
          </div>
        {/each}
      </div>
      <button class="add-btn" onclick={addParam}>+ Add Parameter</button>
    </div>

    <div id="body-tab" class="tab-pane {$activeRequestTab === 'body' ? 'active' : ''}">
      <div class="body-editor-container">
        <div class="body-editor-toolbar">
          <select 
            value={bodyType} 
            onchange={(e) => updateActiveTab('bodyType', e.currentTarget.value)} 
            class="body-type-select"
          >
            <optgroup label="STRUCTURED">
              <option value="form-data">Form Data</option>
              <option value="form-urlencoded">Form URL Encoded</option>
              <option value="graphql">GraphQL</option>
            </optgroup>
            <optgroup label="TEXT">
              <option value="json">JSON</option>
              <option value="xml">XML</option>
              <option value="yaml">YAML</option>
              <option value="html">HTML</option>
              <option value="javascript">JavaScript</option>
              <option value="text">Plain Text</option>
            </optgroup>
            <optgroup label="OTHER">
              <option value="binary">File</option>
              <option value="none">No Body</option>
            </optgroup>
          </select>
          {#if bodyType === 'json' || bodyType === 'xml' || bodyType === 'html'}
            <button 
              class="format-btn" 
              onclick={formatBody} 
              title="Format {bodyType.toUpperCase()} (Ctrl+Shift+F)"
            >
              Format {bodyType.toUpperCase()}
            </button>
          {/if}
        </div>
        
        {#if bodyType === 'none'}
          <div class="empty-state">This request does not have a body.</div>

        {:else if bodyType === 'form-data'}
          <div class="key-value-pairs" id="form-data-container">
            {#each formDataPairs as pair, i}
              <div class="key-value-row">
                <select 
                  value={pair.type} 
                  onchange={(e) => updateFormDataPair(i, 'type', e.currentTarget.value)} 
                  class="type-select"
                >
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
                <VariableInput
                  value={pair.key}
                  {collectionId}
                  oninput={(v) => updateFormDataPair(i, 'key', v)}
                  inputClass="key-input"
                  placeholder="Key"
                />
                {#if pair.type === 'text'}
                  <VariableInput
                    value={pair.value}
                    fieldKey={pair.key}
                    {collectionId}
                    oninput={(v) => updateFormDataPair(i, 'value', v)}
                    inputClass="value-input"
                    placeholder="Value"
                  />
                {:else}
                  <div class="file-field">
                    <span class="file-field-name" title={pair.value}>{pair.fileName || 'No file selected'}</span>
                    <button class="file-field-btn" onclick={() => selectFormDataFile(i)}>Browse</button>
                  </div>
                {/if}
                <button class="remove-btn" onclick={() => removeFormDataPair(i)}>×</button>
              </div>
            {/each}
          </div>
          <button class="add-btn" onclick={addFormDataPair}>+ Add Field</button>

        {:else if bodyType === 'form-urlencoded'}
          <div class="key-value-pairs" id="form-urlencoded-container">
            {#each formUrlencodedPairs as pair, i}
              <div class="key-value-row">
                <VariableInput
                  value={pair.key}
                  {collectionId}
                  oninput={(v) => updateFormUrlencodedPair(i, 'key', v)}
                  inputClass="key-input"
                  placeholder="Key"
                />
                <VariableInput
                  value={pair.value}
                  fieldKey={pair.key}
                  {collectionId}
                  oninput={(v) => updateFormUrlencodedPair(i, 'value', v)}
                  inputClass="value-input"
                  placeholder="Value"
                />
                <button class="remove-btn" onclick={() => removeFormUrlencodedPair(i)}>×</button>
              </div>
            {/each}
          </div>
          <button class="add-btn" onclick={addFormUrlencodedPair}>+ Add Field</button>

        {:else if bodyType === 'graphql'}
          <div class="graphql-container">
            <div class="graphql-section">
              <label for="graphql-query">Query</label>
              <VariableInput
                multiline
                rows={10}
                value={graphqlQuery}
                {collectionId}
                oninput={(v) => updateActiveTab('graphqlQuery', v)}
                inputClass="body-input"
                placeholder="&#123; query &#123; field &#125; &#125;"
              />
            </div>
            <div class="graphql-section">
              <label for="graphql-variables">Variables (JSON)</label>
              <VariableInput
                multiline
                rows={5}
                value={graphqlVariables}
                {collectionId}
                oninput={(v) => updateActiveTab('graphqlVariables', v)}
                inputClass="body-input"
                placeholder='&#123; "key": "value" &#125;'
              />
            </div>
          </div>

        {:else if bodyType === 'binary'}
          <div class="file-upload-area">
            {#if binaryFileName}
              <div class="file-info">
                <span class="file-name">{binaryFileName}</span>
                {#if binaryFileSize}
                  <span class="file-size">{binaryFileSize}</span>
                {/if}
                <button class="remove-file-btn" onclick={clearBinaryFile}>Remove</button>
              </div>
            {:else}
              <div class="file-upload-placeholder">
                <p>Select a file to upload as the request body</p>
                <button class="select-file-btn" onclick={selectBinaryFile}>Choose File</button>
              </div>
            {/if}
          </div>

        {:else if bodyType === 'json'}
          {#key $activeTabId}
            <JsonEditor
              bind:value={localBodyContent}
              {collectionId}
              placeholder="Enter JSON data (auto-formats on paste/blur)"
            />
          {/key}

        {:else}
          <VariableInput
            multiline
            rows={15}
            value={bodyContent}
            {collectionId}
            oninput={(v) => updateActiveTab('bodyContent', v)}
            inputClass="body-input"
            placeholder="Enter {bodyType} data..."
          />
        {/if}
      </div>
    </div>

    <div id="auth-tab" class="tab-pane {$activeRequestTab === 'auth' ? 'active' : ''}">
      <RequestAuthPanel />
    </div>

    <div id="scripts-tab" class="tab-pane {$activeRequestTab === 'scripts' ? 'active' : ''}">
      <RequestScriptsPanel />
    </div>

    <div id="headers-tab" class="tab-pane {$activeRequestTab === 'headers' ? 'active' : ''}">
      <div class="headers-toolbar">
        <div class="template-dropdown-container">
          <button class="template-dropdown-btn" onclick={() => showTemplateDropdown = !showTemplateDropdown}>
            Templates ▾
          </button>
          {#if showTemplateDropdown}
            <div class="template-dropdown">
              <div class="template-section-label">Built-in</div>
              {#each builtInTemplates as tmpl}
                <button class="template-item" onclick={() => applyTemplate(tmpl)}>{tmpl.name}</button>
              {/each}
              {#if customTemplates.length > 0}
                <div class="template-section-label">Custom</div>
                {#each customTemplates as tmpl, i}
                  <div class="template-item-row">
                    <button class="template-item" onclick={() => applyTemplate(tmpl)}>{tmpl.name}</button>
                    <button class="template-delete" onclick={stopPropagation(() => deleteCustomTemplate(i))} title="Delete">×</button>
                  </div>
                {/each}
              {/if}
              <div class="template-divider"></div>
              <button class="template-item save-template" onclick={saveCurrentAsTemplate}>
                💾 Save Current as Template
              </button>
            </div>
          {/if}
        </div>
      </div>
      <div class="key-value-pairs" id="headers-container">
        {#each headers as header, i}
          <div class="key-value-row">
            <VariableInput
              value={header.key}
              {collectionId}
              oninput={(v) => updateHeader(i, 'key', v)}
              inputClass="key-input"
              placeholder="Header name"
              staticOptions={COMMON_HEADERS}
            />
            <VariableInput
              value={header.value}
              fieldKey={header.key}
              {collectionId}
              oninput={(v) => updateHeader(i, 'value', v)}
              inputClass="value-input"
              placeholder="Value"
            />
            <button class="remove-btn" onclick={() => removeHeader(i)}>×</button>
          </div>
        {/each}
      </div>
      <button class="add-btn" onclick={addHeader}>+ Add Header</button>
    </div>

    <div id="docs-tab" class="tab-pane {$activeRequestTab === 'docs' ? 'active' : ''}">
      <div class="docs-container">
        <div class="docs-toolbar">
          <button
            class="docs-mode-btn {docsMode === 'edit' ? 'active' : ''}"
            onclick={() => docsMode = 'edit'}
            title="Edit (Ctrl+Shift+D to toggle)"
          >Edit</button>
          <button
            class="docs-mode-btn {docsMode === 'preview' ? 'active' : ''}"
            onclick={() => docsMode = 'preview'}
            title="Preview (Ctrl+Shift+D to toggle)"
          >Preview</button>
          <span class="docs-hint">Markdown supported</span>
        </div>
        {#if docsMode === 'edit'}
          <textarea
            class="docs-editor"
            placeholder="Write documentation for this request...&#10;&#10;Supports **bold**, *italic*, `code`, lists, links, tables, and code blocks."
            value={$activeTab.description}
            oninput={(e) => updateActiveTab('description', e.currentTarget.value)}
            spellcheck="true"
          ></textarea>
        {:else}
          <div class="docs-preview markdown-body">
            {#if $activeTab.description}
              {@html renderMarkdown($activeTab.description)}
            {:else}
              <p class="docs-empty">No documentation yet. Switch to Edit mode to add notes.</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
  {/if}
</div>

{#if showCodeGenModal}
  <div class="codegen-overlay" use:portal role="dialog" tabindex="-1" onclick={() => showCodeGenModal = false} onkeypress={() => {}}>
    <div class="codegen-modal" role="presentation" onclick={stopPropagation(bubble('click'))} onkeypress={stopPropagation(bubble('keypress'))}>
      <div class="codegen-header">
        <h3>Generate Code</h3>
        <button class="codegen-close" onclick={() => showCodeGenModal = false}>×</button>
      </div>
      <div class="codegen-tabs">
        {#each Object.entries(generators) as [key, gen]}
          <button class="codegen-tab {codeGenLanguage === key ? 'active' : ''}" onclick={() => codeGenLanguage = key}>
            {gen.label}
          </button>
        {/each}
      </div>
      <div class="codegen-body">
        <pre class="codegen-code">{@html highlightedCode}</pre>
      </div>
      <div class="codegen-footer">
        <button class="codegen-copy" onclick={copyGeneratedCode}>Copy</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .bar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 6px;
    flex-shrink: 0;
  }
  .action-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary, #b0b0b0);
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .action-icon-btn:hover {
    background: var(--bg-tertiary, #404040);
    color: var(--text-primary, #fff);
  }
  .action-icon-btn.copied {
    background: rgba(81, 207, 102, 0.15);
    color: var(--success-color, #51cf66);
  }

  .headers-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 0;
  }
  .template-dropdown-container {
    position: relative;
  }
  .template-dropdown-btn {
    padding: 4px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.72rem;
    cursor: pointer;
  }
  .template-dropdown-btn:hover { background: var(--bg-tertiary, #3a3d44); }
  .template-dropdown {
    position: absolute;
    right: 0;
    top: 100%;
    width: 220px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: var(--shadow);
    z-index: 100;
    padding: 4px 0;
  }
  .template-section-label {
    padding: 6px 12px 2px;
    font-size: 0.65rem;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.5px;
  }
  .template-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .template-item:hover { background: var(--bg-tertiary); }
  .template-item-row {
    display: flex;
    align-items: center;
  }
  .template-item-row .template-item { flex: 1; }
  .template-delete {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px 8px;
    font-size: 0.9rem;
  }
  .template-delete:hover { color: #ed4245; }
  .template-divider {
    height: 1px;
    background: var(--border-color);
    margin: 4px 0;
  }
  .save-template { color: var(--accent-color, #5865f2) !important; }

  .codegen-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .codegen-modal {
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    width: min(640px, 90vw);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  .codegen-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-color);
  }
  .codegen-header h3 {
    margin: 0;
    font-size: 1rem;
    color: var(--text-primary);
  }
  .codegen-close {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 1.3rem;
    cursor: pointer;
    padding: 0 4px;
  }
  .codegen-tabs {
    display: flex;
    gap: 2px;
    padding: 8px 18px 0;
    flex-wrap: wrap;
  }
  .codegen-tab {
    padding: 6px 12px;
    border: none;
    border-radius: 4px 4px 0 0;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .codegen-tab:hover:not(.active) { background: var(--bg-tertiary, #3a3d44); }
  .codegen-tab.active {
    background: var(--bg-primary);
    color: var(--text-primary);
  }
  .codegen-body {
    flex: 1;
    overflow: auto;
    padding: 0 18px 12px;
  }
  .codegen-code {
    background: var(--bg-primary, #1e1f22);
    padding: 14px;
    border-radius: 6px;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
  .codegen-footer {
    padding: 10px 18px;
    border-top: 1px solid var(--border-color);
    display: flex;
    justify-content: flex-end;
  }
  .codegen-copy {
    padding: 7px 18px;
    background: var(--accent-color, #5865f2);
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .codegen-copy:hover { opacity: 0.9; }

  /* Syntax highlighting */
  .codegen-code :global(.hl-kw) { color: #c678dd; }
  .codegen-code :global(.hl-str) { color: #98c379; }
  .codegen-code :global(.hl-num) { color: #d19a66; }
  .codegen-code :global(.hl-cmt) { color: #5c6370; font-style: italic; }
  .codegen-code :global(.hl-flag) { color: #56b6c2; }

  .ws-panel-wrapper {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .file-field {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .file-field-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8rem;
    color: var(--text-secondary, #b5bac1);
    padding: 4px 8px;
    background: var(--bg-primary, #1e1f22);
    border-radius: 4px;
    border: 1px solid var(--border-color, #3f4147);
  }
  .file-field-btn {
    padding: 4px 10px;
    background: var(--accent-color, #5865f2);
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .file-field-btn:hover { opacity: 0.85; }

  .tab-dot {
    width: 6px;
    height: 6px;
    background: var(--accent-color, #5865f2);
    border-radius: 50%;
    display: inline-block;
    margin-left: 4px;
    vertical-align: middle;
  }

  .docs-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 200px;
  }
  .docs-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .docs-mode-btn {
    padding: 4px 12px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s;
  }
  .docs-mode-btn.active {
    background: var(--accent-color, #5865f2);
    color: #fff;
  }
  .docs-mode-btn:hover:not(.active) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  .docs-hint {
    margin-left: auto;
    font-size: 0.7rem;
    color: var(--text-muted, #6d6f78);
  }
  .docs-editor {
    flex: 1;
    width: 100%;
    padding: 12px;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: none;
    resize: none;
    font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
    font-size: 0.82rem;
    line-height: 1.6;
    outline: none;
    min-height: 180px;
  }
  .docs-editor::placeholder {
    color: var(--text-muted, #6d6f78);
    opacity: 0.6;
  }
  .docs-preview {
    flex: 1;
    padding: 12px 16px;
    overflow-y: auto;
    font-size: 0.82rem;
    line-height: 1.65;
    color: var(--text-primary);
    min-height: 180px;
  }
  .docs-empty {
    color: var(--text-muted, #6d6f78);
    font-style: italic;
  }

  :global(.markdown-body h1) { font-size: 1.4rem; font-weight: 600; margin: 0 0 10px; border-bottom: 1px solid var(--border-color); padding-bottom: 6px; }
  :global(.markdown-body h2) { font-size: 1.15rem; font-weight: 600; margin: 16px 0 8px; }
  :global(.markdown-body h3) { font-size: 1rem; font-weight: 600; margin: 12px 0 6px; }
  :global(.markdown-body h4) { font-size: 0.9rem; font-weight: 600; margin: 10px 0 4px; }
  :global(.markdown-body p) { margin: 0 0 10px; }
  :global(.markdown-body code) {
    background: var(--bg-tertiary, #2b2d31);
    padding: 2px 5px;
    border-radius: 3px;
    font-family: 'SF Mono', 'Consolas', monospace;
    font-size: 0.85em;
  }
  :global(.markdown-body pre) {
    background: var(--bg-primary, #1e1f22);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 10px 14px;
    margin: 8px 0;
    overflow-x: auto;
  }
  :global(.markdown-body pre code) { background: none; padding: 0; font-size: 0.82rem; line-height: 1.5; }
  :global(.markdown-body a) { color: var(--accent-color, #5865f2); text-decoration: none; }
  :global(.markdown-body a:hover) { text-decoration: underline; }
  :global(.markdown-body ul, .markdown-body ol) { padding-left: 20px; margin: 6px 0; }
  :global(.markdown-body li) { margin: 3px 0; }
  :global(.markdown-body blockquote) {
    border-left: 3px solid var(--accent-color, #5865f2);
    margin: 8px 0;
    padding: 4px 12px;
    color: var(--text-secondary);
    background: rgba(88, 101, 242, 0.05);
    border-radius: 0 4px 4px 0;
  }
  :global(.markdown-body hr) { border: none; border-top: 1px solid var(--border-color); margin: 12px 0; }
  :global(.markdown-body table) { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 0.82rem; }
  :global(.markdown-body th, .markdown-body td) { border: 1px solid var(--border-color); padding: 6px 10px; }
  :global(.markdown-body th) { background: var(--bg-tertiary); font-weight: 600; }
  :global(.markdown-body strong) { font-weight: 600; }
  :global(.markdown-body del) { opacity: 0.6; }
  :global(.markdown-body img) { max-width: 100%; border-radius: 6px; }
</style>
