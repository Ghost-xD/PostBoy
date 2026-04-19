<script lang="ts">
  import { onMount } from 'svelte';
  import { activeTab, updateActiveTab, updateActiveTabBatch, updateTab, activeTabId } from '$lib/stores/tabStore';
  import { get } from 'svelte/store';
  import { activeRequestTab, isSendingRequest, sendingTabIds } from '$lib/stores/uiStore';
  import { addLog } from '$lib/stores/consoleStore';
  import { db, fileOps, http } from '$lib/api/tauri';
  import { getSettingsForRequest } from '$lib/stores/settingsStore';
  import { parseCurlCommand, generateCurlCommand } from '$lib/utils/curlParser';
  import { renderMarkdown } from '$lib/utils/markdownRenderer';
  import { generators, type CodeGenOptions } from '$lib/utils/codeGenerator';
  import { variables, interpolate, interpolateKeyValues, getAllUnresolvedVariables } from '$lib/stores/variableStore';
  import JsonEditor from './JsonEditor.svelte';
  import WebSocketPanel from './WebSocketPanel.svelte';
  import SsePanel from './SsePanel.svelte';
  import MethodSelect from './MethodSelect.svelte';
  import { initWsListeners } from '$lib/stores/wsStore';
  import { initSseListeners } from '$lib/stores/sseStore';
  import { captureCookies, injectCookies } from '$lib/stores/cookieStore';

  export let onHistoryUpdate: () => Promise<void> = async () => {};

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

  let customTemplates: HeaderTemplate[] = [];
  let showTemplateDropdown = false;
  let docsMode: 'edit' | 'preview' = 'edit';

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
  let curlCopied = false;
  let curlCopiedTimeout: ReturnType<typeof setTimeout> | null = null;

  export async function copyAsCurl() {
    const collectionId = $activeTab.collectionId;
    const resolvedUrl = interpolate(url, collectionId);
    const resolvedHeaders = interpolateKeyValues(headers, collectionId);
    const resolvedBody = interpolate(bodyContent, collectionId);
    const resolvedAuthToken = interpolate(authToken, collectionId);
    const resolvedAuthUsername = interpolate(authUsername, collectionId);
    const resolvedAuthPassword = interpolate(authPassword, collectionId);
    const resolvedAuthApiKey = interpolate(authApiKey, collectionId);
    const resolvedAuthApiValue = interpolate(authApiValue, collectionId);

    const curlCmd = generateCurlCommand({
      method, url: resolvedUrl, headers: resolvedHeaders, body: resolvedBody, bodyType,
      formDataPairs: bodyType === 'form-data' ? formDataPairs : undefined,
      authType, authToken: resolvedAuthToken, authUsername: resolvedAuthUsername,
      authPassword: resolvedAuthPassword, authApiKey: resolvedAuthApiKey, authApiValue: resolvedAuthApiValue,
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
  let showCodeGenModal = false;
  let codeGenLanguage = 'fetch';

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.parentNode?.removeChild(node); } };
  }

  function getCodeGenOptions(): CodeGenOptions {
    return { method, url, headers: headers.filter(h => h.key && h.value), body: bodyContent, bodyType, authType, authToken, authUsername, authPassword, authApiKey, authApiValue };
  }

  $: generatedCode = showCodeGenModal ? generators[codeGenLanguage]?.generate(getCodeGenOptions()) || '' : '';

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

  $: highlightedCode = showCodeGenModal ? highlightCode(generatedCode, generators[codeGenLanguage]?.language || 'javascript') : '';

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

  $: isCurrentTabSending = $sendingTabIds.has($activeTab.id);

  // Reactive getters from active tab
  $: method = $activeTab.method;
  $: isWsMethod = method === 'WS' || method === 'WSS';
  $: isSseMethod = method === 'SSE';

  $: url = $activeTab.url;
  $: params = $activeTab.params;
  $: headers = $activeTab.headers;
  $: bodyType = $activeTab.bodyType;
  $: bodyContent = $activeTab.bodyContent;
  $: formDataPairs = $activeTab.formDataPairs;
  $: formUrlencodedPairs = $activeTab.formUrlencodedPairs;
  $: graphqlQuery = $activeTab.graphqlQuery;
  $: graphqlVariables = $activeTab.graphqlVariables;
  $: binaryFileName = $activeTab.binaryFileName;
  $: binaryFilePath = $activeTab.binaryFilePath;
  $: binaryFileSize = $activeTab.binaryFileSize;
  $: authType = $activeTab.authType;
  $: authUsername = $activeTab.authUsername;
  $: authPassword = $activeTab.authPassword;
  $: authToken = $activeTab.authToken;
  $: authApiKey = $activeTab.authApiKey;
  $: authApiValue = $activeTab.authApiValue;

  // Local body content for JsonEditor two-way binding
  let localBodyContent = '';
  $: localBodyContent = bodyContent;
  $: if (localBodyContent !== bodyContent) {
    updateActiveTab('bodyContent', localBodyContent);
  }

  function handleUrlInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const value = input.value.trim();
    
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
      const fakeEvent = { target: { value: pasted } } as unknown as Event;
      handleUrlInput(fakeEvent);
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
      bodyContent, authToken, authUsername, authPassword, authApiKey, authApiValue
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
        const urlParams = new URLSearchParams();
        validParams.forEach(p => urlParams.append(p.key, p.value));
        requestUrl += (resolvedUrl.includes('?') ? '&' : '?') + urlParams.toString();
      }

      // Interpolate headers
      const resolvedHeaders = interpolateKeyValues(headers, collectionId);
      const headersObj: Record<string, string> = {};
      resolvedHeaders.filter(h => h.key && h.value).forEach(h => {
        headersObj[h.key] = h.value;
      });

      // Interpolate auth fields
      const resolvedAuthToken = interpolate(authToken, collectionId);
      const resolvedAuthUsername = interpolate(authUsername, collectionId);
      const resolvedAuthPassword = interpolate(authPassword, collectionId);
      const resolvedAuthApiKey = interpolate(authApiKey, collectionId);
      const resolvedAuthApiValue = interpolate(authApiValue, collectionId);

      if (authType === 'bearer' && resolvedAuthToken) {
        headersObj['Authorization'] = `Bearer ${resolvedAuthToken}`;
      } else if (authType === 'basic' && resolvedAuthUsername) {
        headersObj['Authorization'] = `Basic ${btoa(`${resolvedAuthUsername}:${resolvedAuthPassword}`)}`;
      } else if (authType === 'api-key' && resolvedAuthApiKey) {
        headersObj[resolvedAuthApiKey] = resolvedAuthApiValue;
      }

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
            const boundary = '----PostBoyFormBoundary' + Date.now();
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
          requestBody = interpolate(bodyContent, collectionId);
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

      if (collectionId && !headersObj['Cookie']) {
        const cookieHeader = await injectCookies(collectionId, requestUrl);
        if (cookieHeader) {
          headersObj['Cookie'] = cookieHeader;
        }
      }

      const reqSettings = getSettingsForRequest();
      const response: any = await http.executeRequest(
        method,
        requestUrl,
        Object.keys(headersObj).length > 0 ? headersObj : undefined,
        requestBody,
        reqSettings
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

      if (collectionId && response.headers) {
        const headerEntries = Object.entries(response.headers) as Array<[string, string]>;
        await captureCookies(collectionId, headerEntries, requestUrl);
      }

      const authData: any = {};
      if (authType === 'basic') {
        authData.username = authUsername;
        authData.password = authPassword;
      } else if (authType === 'bearer') {
        authData.token = authToken;
      } else if (authType === 'api-key') {
        authData.key = authApiKey;
        authData.value = authApiValue;
      }

      await db.addHistory(
        { method, url: requestUrl, headers: headersObj, params: validParams, bodyType, bodyContent, authType, authData },
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
      <input 
        type="text" 
        id="url-input"
        value={url}
        on:input={handleUrlInput}
        on:paste={handlePaste}
        placeholder={isWsMethod ? 'Enter WebSocket URL (ws:// or wss://)' : isSseMethod ? 'Enter SSE endpoint URL' : 'Enter request URL or paste curl command'}
        class="url-input"
        on:keypress={(e) => e.key === 'Enter' && !isWsMethod && !isSseMethod && sendRequest()}
      />
      <div class="bar-actions">
        <button class="action-icon-btn {curlCopied ? 'copied' : ''}" on:click={copyAsCurl} title="Copy as cURL (Ctrl+Shift+K)">
          {#if curlCopied}
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
          {:else}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.912 4.895 3 6 3h8c1.105 0 2 .912 2 2.036v1.866"/><rect x="8" y="7" width="12" height="14" rx="2"/></svg>
          {/if}
        </button>
        <button class="action-icon-btn" on:click={() => showCodeGenModal = true} title="Generate Code (Ctrl+Shift+G)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </button>
      </div>
    </div>
    {#if !isWsMethod && !isSseMethod}
    <button id="send-btn" on:click={sendRequest} class="send-btn" disabled={isCurrentTabSending} title="Send Request (Ctrl+Enter)">
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
  {:else}
  <div class="request-tabs">
    <button 
      class="tab-btn {$activeRequestTab === 'params' ? 'active' : ''}" 
      on:click={() => activeRequestTab.set('params')}
      title="Params (Ctrl+P)"
    >
      Params
      <span class="tab-count">{params.filter(p => p.key).length}</span>
    </button>
    <button 
      class="tab-btn {$activeRequestTab === 'body' ? 'active' : ''}"
      on:click={() => activeRequestTab.set('body')}
      title="Body (Ctrl+B)"
    >
      Body
    </button>
    <button 
      class="tab-btn {$activeRequestTab === 'auth' ? 'active' : ''}"
      on:click={() => activeRequestTab.set('auth')}
      title="Authorization (Ctrl+Shift+A)"
    >
      Authorization
    </button>
    <button 
      class="tab-btn {$activeRequestTab === 'headers' ? 'active' : ''}"
      on:click={() => activeRequestTab.set('headers')}
      title="Headers (Ctrl+H)"
    >
      Headers
      <span class="tab-count">{headers.filter(h => h.key).length}</span>
    </button>
    <button
      class="tab-btn {$activeRequestTab === 'docs' ? 'active' : ''}"
      on:click={() => activeRequestTab.set('docs')}
      title="Documentation (Ctrl+D)"
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
            <input 
              type="text" 
              value={param.key} 
              on:input={(e) => updateParam(i, 'key', e.currentTarget.value)} 
              placeholder="Key" 
              class="key-input" 
            />
            <input 
              type="text" 
              value={param.value} 
              on:input={(e) => updateParam(i, 'value', e.currentTarget.value)} 
              placeholder="Value" 
              class="value-input" 
            />
            <button class="remove-btn" on:click={() => removeParam(i)}>×</button>
          </div>
        {/each}
      </div>
      <button class="add-btn" on:click={addParam}>+ Add Parameter</button>
    </div>

    <div id="body-tab" class="tab-pane {$activeRequestTab === 'body' ? 'active' : ''}">
      <div class="body-editor-container">
        <div class="body-editor-toolbar">
          <select 
            value={bodyType} 
            on:change={(e) => updateActiveTab('bodyType', e.currentTarget.value)} 
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
              on:click={formatBody} 
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
                  on:change={(e) => updateFormDataPair(i, 'type', e.currentTarget.value)} 
                  class="type-select"
                >
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
                <input 
                  type="text" 
                  value={pair.key} 
                  on:input={(e) => updateFormDataPair(i, 'key', e.currentTarget.value)} 
                  placeholder="Key" 
                  class="key-input" 
                />
                {#if pair.type === 'text'}
                  <input 
                    type="text" 
                    value={pair.value} 
                    on:input={(e) => updateFormDataPair(i, 'value', e.currentTarget.value)} 
                    placeholder="Value" 
                    class="value-input" 
                  />
                {:else}
                  <div class="file-field">
                    <span class="file-field-name" title={pair.value}>{pair.fileName || 'No file selected'}</span>
                    <button class="file-field-btn" on:click={() => selectFormDataFile(i)}>Browse</button>
                  </div>
                {/if}
                <button class="remove-btn" on:click={() => removeFormDataPair(i)}>×</button>
              </div>
            {/each}
          </div>
          <button class="add-btn" on:click={addFormDataPair}>+ Add Field</button>

        {:else if bodyType === 'form-urlencoded'}
          <div class="key-value-pairs" id="form-urlencoded-container">
            {#each formUrlencodedPairs as pair, i}
              <div class="key-value-row">
                <input 
                  type="text" 
                  value={pair.key} 
                  on:input={(e) => updateFormUrlencodedPair(i, 'key', e.currentTarget.value)} 
                  placeholder="Key" 
                  class="key-input" 
                />
                <input 
                  type="text" 
                  value={pair.value} 
                  on:input={(e) => updateFormUrlencodedPair(i, 'value', e.currentTarget.value)} 
                  placeholder="Value" 
                  class="value-input" 
                />
                <button class="remove-btn" on:click={() => removeFormUrlencodedPair(i)}>×</button>
              </div>
            {/each}
          </div>
          <button class="add-btn" on:click={addFormUrlencodedPair}>+ Add Field</button>

        {:else if bodyType === 'graphql'}
          <div class="graphql-container">
            <div class="graphql-section">
              <label for="graphql-query">Query</label>
              <textarea 
                id="graphql-query"
                value={graphqlQuery}
                on:input={(e) => updateActiveTab('graphqlQuery', e.currentTarget.value)}
                placeholder="&#123; query &#123; field &#125; &#125;"
                class="body-input"
                rows="10"
              ></textarea>
            </div>
            <div class="graphql-section">
              <label for="graphql-variables">Variables (JSON)</label>
              <textarea 
                id="graphql-variables"
                value={graphqlVariables}
                on:input={(e) => updateActiveTab('graphqlVariables', e.currentTarget.value)}
                placeholder='&#123; "key": "value" &#125;'
                class="body-input"
                rows="5"
              ></textarea>
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
                <button class="remove-file-btn" on:click={clearBinaryFile}>Remove</button>
              </div>
            {:else}
              <div class="file-upload-placeholder">
                <p>Select a file to upload as the request body</p>
                <button class="select-file-btn" on:click={selectBinaryFile}>Choose File</button>
              </div>
            {/if}
          </div>

        {:else if bodyType === 'json'}
          <JsonEditor 
            bind:value={localBodyContent}
            placeholder="Enter JSON data (auto-formats on paste/blur)" 
          />

        {:else}
          <textarea 
            value={bodyContent}
            on:input={(e) => updateActiveTab('bodyContent', e.currentTarget.value)}
            placeholder="Enter {bodyType} data..."
            class="body-input"
            rows="15"
          ></textarea>
        {/if}
      </div>
    </div>

    <div id="auth-tab" class="tab-pane {$activeRequestTab === 'auth' ? 'active' : ''}">
      <div class="auth-section">
        <div class="auth-type-selector">
          <label for="auth-type">Type:</label>
          <select 
            id="auth-type" 
            value={authType} 
            on:change={(e) => updateActiveTab('authType', e.currentTarget.value)} 
            class="auth-type-select"
          >
            <option value="none">No Auth</option>
            <option value="basic">Basic Auth</option>
            <option value="bearer">Bearer Token</option>
            <option value="api-key">API Key</option>
          </select>
        </div>
        <div class="auth-content">
          {#if authType === 'basic'}
            <input 
              type="text" 
              value={authUsername} 
              on:input={(e) => updateActiveTab('authUsername', e.currentTarget.value)} 
              placeholder="Username" 
              class="auth-input" 
            />
            <input 
              type="password" 
              value={authPassword} 
              on:input={(e) => updateActiveTab('authPassword', e.currentTarget.value)} 
              placeholder="Password" 
              class="auth-input" 
            />
          {:else if authType === 'bearer'}
            <input 
              type="text" 
              value={authToken} 
              on:input={(e) => updateActiveTab('authToken', e.currentTarget.value)} 
              placeholder="Token" 
              class="auth-input" 
            />
          {:else if authType === 'api-key'}
            <input 
              type="text" 
              value={authApiKey} 
              on:input={(e) => updateActiveTab('authApiKey', e.currentTarget.value)} 
              placeholder="Key" 
              class="auth-input" 
            />
            <input 
              type="text" 
              value={authApiValue} 
              on:input={(e) => updateActiveTab('authApiValue', e.currentTarget.value)} 
              placeholder="Value" 
              class="auth-input" 
            />
          {:else}
            <div class="empty-state">This request does not use any authorization.</div>
          {/if}
        </div>
      </div>
    </div>

    <div id="headers-tab" class="tab-pane {$activeRequestTab === 'headers' ? 'active' : ''}">
      <div class="headers-toolbar">
        <div class="template-dropdown-container">
          <button class="template-dropdown-btn" on:click={() => showTemplateDropdown = !showTemplateDropdown}>
            Templates ▾
          </button>
          {#if showTemplateDropdown}
            <div class="template-dropdown">
              <div class="template-section-label">Built-in</div>
              {#each builtInTemplates as tmpl}
                <button class="template-item" on:click={() => applyTemplate(tmpl)}>{tmpl.name}</button>
              {/each}
              {#if customTemplates.length > 0}
                <div class="template-section-label">Custom</div>
                {#each customTemplates as tmpl, i}
                  <div class="template-item-row">
                    <button class="template-item" on:click={() => applyTemplate(tmpl)}>{tmpl.name}</button>
                    <button class="template-delete" on:click|stopPropagation={() => deleteCustomTemplate(i)} title="Delete">×</button>
                  </div>
                {/each}
              {/if}
              <div class="template-divider"></div>
              <button class="template-item save-template" on:click={saveCurrentAsTemplate}>
                💾 Save Current as Template
              </button>
            </div>
          {/if}
        </div>
      </div>
      <div class="key-value-pairs" id="headers-container">
        {#each headers as header, i}
          <div class="key-value-row">
            <input 
              type="text" 
              value={header.key} 
              on:input={(e) => updateHeader(i, 'key', e.currentTarget.value)} 
              on:change={(e) => updateHeader(i, 'key', e.currentTarget.value)}
              placeholder="Header name" 
              class="key-input" 
              list="common-headers" 
            />
            <input 
              type="text" 
              value={header.value} 
              on:input={(e) => updateHeader(i, 'value', e.currentTarget.value)} 
              on:change={(e) => updateHeader(i, 'value', e.currentTarget.value)}
              placeholder="Value" 
              class="value-input" 
            />
            <button class="remove-btn" on:click={() => removeHeader(i)}>×</button>
          </div>
        {/each}
      </div>
      <button class="add-btn" on:click={addHeader}>+ Add Header</button>
      <datalist id="common-headers">
        <option value="Accept" />
        <option value="Accept-Encoding" />
        <option value="Accept-Language" />
        <option value="Authorization" />
        <option value="Cache-Control" />
        <option value="Content-Type" />
        <option value="Cookie" />
        <option value="Host" />
        <option value="If-Modified-Since" />
        <option value="If-None-Match" />
        <option value="Origin" />
        <option value="Pragma" />
        <option value="Referer" />
        <option value="User-Agent" />
        <option value="X-API-Key" />
        <option value="X-Requested-With" />
        <option value="X-Correlation-ID" />
        <option value="X-Forwarded-For" />
      </datalist>
    </div>

    <div id="docs-tab" class="tab-pane {$activeRequestTab === 'docs' ? 'active' : ''}">
      <div class="docs-container">
        <div class="docs-toolbar">
          <button
            class="docs-mode-btn {docsMode === 'edit' ? 'active' : ''}"
            on:click={() => docsMode = 'edit'}
            title="Edit (Ctrl+Shift+D to toggle)"
          >Edit</button>
          <button
            class="docs-mode-btn {docsMode === 'preview' ? 'active' : ''}"
            on:click={() => docsMode = 'preview'}
            title="Preview (Ctrl+Shift+D to toggle)"
          >Preview</button>
          <span class="docs-hint">Markdown supported</span>
        </div>
        {#if docsMode === 'edit'}
          <textarea
            class="docs-editor"
            placeholder="Write documentation for this request...&#10;&#10;Supports **bold**, *italic*, `code`, lists, links, tables, and code blocks."
            value={$activeTab.description}
            on:input={(e) => updateActiveTab('description', e.currentTarget.value)}
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
  <div class="codegen-overlay" use:portal role="dialog" tabindex="-1" on:click={() => showCodeGenModal = false} on:keypress={() => {}}>
    <div class="codegen-modal" role="presentation" on:click|stopPropagation on:keypress|stopPropagation>
      <div class="codegen-header">
        <h3>Generate Code</h3>
        <button class="codegen-close" on:click={() => showCodeGenModal = false}>×</button>
      </div>
      <div class="codegen-tabs">
        {#each Object.entries(generators) as [key, gen]}
          <button class="codegen-tab {codeGenLanguage === key ? 'active' : ''}" on:click={() => codeGenLanguage = key}>
            {gen.label}
          </button>
        {/each}
      </div>
      <div class="codegen-body">
        <pre class="codegen-code">{@html highlightedCode}</pre>
      </div>
      <div class="codegen-footer">
        <button class="codegen-copy" on:click={copyGeneratedCode}>Copy</button>
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
    background: var(--bg-secondary, #2b2d31);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    z-index: 100;
    padding: 4px 0;
  }
  .template-section-label {
    padding: 6px 12px 2px;
    font-size: 0.65rem;
    text-transform: uppercase;
    color: var(--text-muted, #72767d);
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
  .template-item:hover { background: var(--bg-tertiary, #3a3d44); }
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
  .codegen-tab:hover { background: var(--bg-tertiary, #3a3d44); }
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
