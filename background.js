(async function initBackground() {
  const scriptsToLoad = [
    'browser-polyfill.js',
    'shared/browser-api.js',
    'config.js',
    'shared/prompts.js'
  ];

  async function loadScript(scriptPath) {
    const scriptUrl = chrome.runtime.getURL(scriptPath);
    await import(scriptUrl);
  }

  try {
    if (typeof importScripts === 'function') {
      importScripts(...scriptsToLoad);
    } else {
      for (const script of scriptsToLoad) {
        await loadScript(script);
      }
    }
  } catch (error) {
    console.error('❌ Failed to load background dependencies:', error);
    return;
  }

  const storageGet = (...args) => GFBrowser.storageGet(...args);
  const storageSet = (...args) => GFBrowser.storageSet(...args);
  const tabsQuery = (...args) => GFBrowser.tabsQuery(...args);
  const runtimeSendMessage = (...args) => GFBrowser.runtimeSendMessage(...args);

  const POLLING_INTERVALS = {
    STARTUP_ELEMENT_CHECK: 500,           // How often to check for elements during page load (ms)
    STARTUP_MAX_ATTEMPTS: 2,            // Maximum attempts to find elements during startup
    SCROLL_ACTIVE: 500,                  // Fast polling during active scrolling (ms)
    SCROLL_IDLE: 5000,                   // Slow polling when not scrolling (ms)
    SCROLL_ACTIVITY_TIMEOUT: 5000,       // Time to wait before considering scrolling "stopped" (ms)
  };

  const VISUAL_EFFECTS = {
    BLUR_RADIUS: '6px',                  // Blur intensity for filtered content
    GRAYSCALE_AMOUNT: '100%',            // Grayscale level for filtered content
    BRIGHTNESS_LEVEL: '0.2',             // Brightness reduction for filtered content
    WAITING_OPACITY: '0.8',              // Opacity while waiting for AI response
    BLOCKED_OPACITY: '0',                // Opacity for blocked content (hidden)
    ALLOWED_OPACITY: '',                 // Opacity for allowed content (normal)
  };

  const UI_TIMEOUTS = {
    POPUP_MESSAGE_DISPLAY: 3000,         // How long popup messages stay visible (ms)
  };

  let lastApiCall = 0;
  const MIN_API_INTERVAL = 100;
  let isApiCallInProgress = false;
  const pendingApiCalls = [];

  const tabFilteringStates = new Map();
  let globalApiRequestCount = 0;
  let testMocksInstalled = false;
  const TEST_BRIDGE_TOKEN_TTL = 5 * 60 * 1000;
  const testBridgeAuthorizations = new Map();

  function generateTestBridgeToken() {
    const buffer = new Uint8Array(16);
    crypto.getRandomValues(buffer);
    return Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function getActiveBridgeAuthorization(tabId) {
    const entry = testBridgeAuthorizations.get(tabId);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      testBridgeAuthorizations.delete(tabId);
      return null;
    }
    return entry;
  }

  function setBridgeAuthorization(tabId) {
    const token = generateTestBridgeToken();
    const expiresAt = Date.now() + TEST_BRIDGE_TOKEN_TTL;
    const entry = { token, expiresAt };
    testBridgeAuthorizations.set(tabId, entry);
    return entry;
  }

  function validateBridgeRequest(sender, bridgeToken) {
    const tabId = sender?.tab?.id;
    if (typeof tabId !== 'number') {
      return null;
    }
    const entry = getActiveBridgeAuthorization(tabId);
    if (!entry || entry.token !== bridgeToken) {
      return null;
    }
    // Extend authorization on activity to keep tests alive.
    entry.expiresAt = Date.now() + TEST_BRIDGE_TOKEN_TTL;
    return { tabId, entry };
  }

  function isTestEnvironment() {
    return globalThis.__GF_ENABLE_TEST_BRIDGE__ === true || globalThis.navigator?.webdriver === true;
  }

  initializeGlobalApiCounter();

  function installTestApiMocks() {
    if (testMocksInstalled) {
      return;
    }

    const originalFetch = fetch;
    self.__gf_originalFetch = originalFetch;
    testMocksInstalled = true;

    fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const isFilteringRequest =
        url.includes('great-filter-vps.vercel.app') || url.includes('openrouter.ai');

      if (!isFilteringRequest) {
        return originalFetch(input, init);
      }

      let body = {};
      try {
        body = init.body ? JSON.parse(init.body) : {};
      } catch (error) {
        console.error('Failed to parse mocked request body', error);
      }

      self.__gf_lastApiRequest = { url, body };

      if (body.model === CONFIG.RECOMMENDATION_MODEL) {
        const recommendationPayload = {
          choices: [
            {
              message: {
                content: 'Block politics',
              },
            },
          ],
        };
        return new Response(JSON.stringify(recommendationPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const itemCount = (() => {
        if (typeof body.postCount === 'number') {
          return body.postCount;
        }

        const messageContent = body.messages?.[0]?.content;
        if (Array.isArray(messageContent)) {
          return messageContent.filter(entry => {
            if (entry?.type !== 'text') return false;
            return /\d+\./.test(entry.text || '');
          }).length;
        }

        if (typeof messageContent === 'string') {
          const matches = messageContent.match(/\n?\d+\./g);
          if (matches) {
            return matches.length;
          }
          return messageContent.trim() ? 1 : 0;
        }

        return 0;
      })();

      const lines = Array.from({ length: itemCount || 1 }, (_, index) => {
        const decision = index % 2 === 0 ? 'YES' : 'NO';
        return `${index + 1}. → ${decision}`;
      }).join('\n');

      const payload = {
        choices: [
          {
            message: {
              content: lines,
            },
          },
        ],
        usage: {
          prompt_tokens: 10 * (itemCount || 1),
          completion_tokens: 8 * (itemCount || 1),
          total_tokens: 18 * (itemCount || 1),
        },
      };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }

  async function getApiConfiguration() {
    try {
      const result = await storageGet(['useOwnApiKey', 'apiKey', 'selectedModel']);
      const useOwnApiKey = result.useOwnApiKey === true;
      const apiKey = result.apiKey || '';
      const model = result.selectedModel || CONFIG.MODEL;

      return {
        useOwnApiKey,
        apiKey,
        model,
        url: useOwnApiKey ? CONFIG.OPENROUTER_API_URL : CONFIG.PROXY_URL,
        headers: useOwnApiKey
          ? {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://great-filter.extension',
              'X-Title': 'Great Filter Extension'
            }
          : {
              'Content-Type': 'application/json'
            }
      };
    } catch (error) {
      console.error('Error getting API configuration:', error);
      return {
        useOwnApiKey: false,
        apiKey: '',
        model: CONFIG.MODEL,
        url: CONFIG.PROXY_URL,
        headers: { 'Content-Type': 'application/json' }
      };
    }
  }

  async function initializeGlobalApiCounter() {
    try {
      const result = await storageGet(['globalApiRequestCount']);
      globalApiRequestCount = result.globalApiRequestCount || 0;
    } catch (error) {
      console.error('Error initializing global API counter:', error);
      globalApiRequestCount = 0;
    }
  }

  async function incrementGlobalApiCounter(postCount = 1) {
    globalApiRequestCount += postCount;
    try {
      await storageSet({ globalApiRequestCount });
    } catch (error) {
      console.error('Error saving global API counter:', error);
    }
  }

  async function getCurrentTabId() {
    try {
      const tabs = await tabsQuery({ active: true, currentWindow: true });
      return tabs[0]?.id;
    } catch (error) {
      console.error('Error getting current tab ID:', error);
      return null;
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const isTestAction = typeof request.action === 'string' && request.action.startsWith('gf-test:');
    const isExtensionSender =
      !sender ||
      (typeof sender.url === 'string' && sender.url.startsWith('chrome-extension://')) ||
      sender.origin === 'null';

    if (request.action === 'gf-test:requestBridgeToken') {
      const tabId = sender?.tab?.id;
      if (typeof tabId !== 'number') {
        sendResponse({ ok: false, error: 'TAB_ID_REQUIRED' });
        return true;
      }

      const shouldAutoAuthorize =
        request.webdriver === true || isTestEnvironment();

      let entry = getActiveBridgeAuthorization(tabId);
      if (!entry) {
        if (!shouldAutoAuthorize) {
          sendResponse({ ok: false, error: 'UNAUTHORIZED' });
          return true;
        }
        entry = setBridgeAuthorization(tabId);
      }

      entry.expiresAt = Date.now() + TEST_BRIDGE_TOKEN_TTL;
      sendResponse({ ok: true, token: entry.token, expiresAt: entry.expiresAt });
      return true;
    }

    if (isTestAction) {
      const authorization = validateBridgeRequest(sender, request.bridgeToken);
      if (!authorization) {
        sendResponse({ ok: false, error: 'UNAUTHORIZED' });
        return true;
      }

      if (request.action === 'gf-test:clearStorage') {
        chrome.storage.local.clear(() => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ ok: true });
          }
        });
        return true;
      }

      if (request.action === 'gf-test:setStorage') {
        chrome.storage.local.set(request.state || {}, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ ok: true });
          }
        });
        return true;
      }

      if (request.action === 'gf-test:getStorage') {
        chrome.storage.local.get(request.keys || null, result => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ ok: true, data: result });
          }
        });
        return true;
      }

      if (request.action === 'gf-test:installMocks') {
        installTestApiMocks();
        sendResponse({ ok: true });
        return true;
      }

      if (request.action === 'gf-test:getLastApiRequest') {
        sendResponse({ ok: true, request: self.__gf_lastApiRequest || null });
        return true;
      }
    }

    if (request.action === 'checkItemTitlesBatch') {
      incrementGlobalApiCounter(request.items.length);

      if (isApiCallInProgress) {
        pendingApiCalls.push({ items: request.items, topics: request.topics, sendResponse });
        return true;
      }

      handleBatchItemTitleCheck(request.items, request.topics, sendResponse);
      return true;
    }

    if (request.action === 'getRecommendedFilter') {
      handleRecommendedFilter(request.items, sendResponse);
      return true;
    }

    if (request.action === 'filteringStarted') {
      getCurrentTabId().then(tabId => {
        if (tabId) {
          tabFilteringStates.set(tabId, 'processing');
        }
      });
      runtimeSendMessage(request).catch(() => {});
      return true;
    }

    if (request.action === 'filteringStopped') {
      getCurrentTabId().then(tabId => {
        if (tabId) {
          tabFilteringStates.set(tabId, 'inactive');
        }
      });
      return true;
    }

    if (request.action === 'filteringComplete') {
      getCurrentTabId().then(tabId => {
        if (tabId) {
          tabFilteringStates.set(tabId, 'active');
        }
      });
      return true;
    }

    if (request.action === 'contentProcessing') {
      getCurrentTabId().then(tabId => {
        if (tabId) {
          tabFilteringStates.set(tabId, 'processing');
        }
      });
      return true;
    }


  });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const savedState = tabFilteringStates.get(activeInfo.tabId);
  });

  chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  });

  chrome.runtime.onStartup.addListener(() => {
    initializeGlobalApiCounter();
  });

  chrome.runtime.onInstalled.addListener(() => {
    initializeGlobalApiCounter();
  });

  async function handleBatchItemTitleCheck(items, topics, sendResponse) {
    isApiCallInProgress = true;

    try {
      const apiConfig = await getApiConfiguration();

      if (!apiConfig.url) {
        throw new Error('API URL not configured');
      }

      if (apiConfig.useOwnApiKey && !apiConfig.apiKey) {
        throw new Error('API key is required when using own OpenRouter key');
      }

      if (!topics || topics.length === 0) {
        throw new Error('No preferences configured');
      }

      const settingsResult = await storageGet(['sendImages']);
      const sendImages = settingsResult.sendImages === true;

      const prompt = PromptTemplates.createBatchPrompt(items, topics, sendImages);

      console.log('Full prompt:\n', typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2));

      const requestBody = {
        model: apiConfig.model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: CONFIG.MAX_TOKENS,
        temperature: 0
      };

      if (!apiConfig.useOwnApiKey) {
        requestBody.postCount = items.length;
      }

      const response = await fetch(apiConfig.url, {
        method: 'POST',
        headers: apiConfig.headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);

        if (response.status === 429 && errorData && errorData.error === 'Daily limit exceeded') {
          sendResponse({
            error: 'DAILY_LIMIT_EXCEEDED',
            message: errorData.message,
            dailyLimit: errorData.dailyLimit,
            currentUsage: errorData.currentUsage,
            remaining: errorData.remaining,
            resetTime: errorData.resetTime
          });
          return;
        }

        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      console.log('Full response:\n', JSON.stringify(data, null, 2));

      if (data.usage) {
        const inputTokens = data.usage.prompt_tokens || 0;
        const outputTokens = data.usage.completion_tokens || 0;
        const totalTokens = data.usage.total_tokens || 0;

        const inputCost = (inputTokens / 1000000) * 0.10;
        const outputCost = (outputTokens / 1000000) * 0.40;
        const totalCost = inputCost + outputCost;
      }

      if (data.choices && data.choices[0]) {
        const fullResponse = data.choices[0].message.content.trim();

        const lines = fullResponse.split('\n').filter(line => line.trim() !== '');
        const results = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          let isAllowed = false;

          const expectedNumber = i + 1;
          const responseLine = lines.find(line =>
            line.trim().startsWith(`${expectedNumber}.`) ||
            line.trim().startsWith(`${expectedNumber}`)
          );

          if (responseLine) {
            const answer = responseLine.toLowerCase();
            isAllowed = answer.includes('yes');
          }

          results.push({
            title: item.title,
            isAllowed: isAllowed,
            responseLine: responseLine || 'No response'
          });
        }

        sendResponse({
          results: results,
          fullResponse: fullResponse
        });
      } else {
        throw new Error('Invalid API response: ' + (data.error?.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('❌ Error in handleBatchItemTitleCheck:', error);
      sendResponse({ error: error.message });
    } finally {
      isApiCallInProgress = false;
      processNextPendingCall();
    }
  }

  function processNextPendingCall() {
    if (pendingApiCalls.length > 0 && !isApiCallInProgress) {
      const nextCall = pendingApiCalls.shift();
      handleBatchItemTitleCheck(nextCall.items, nextCall.topics, nextCall.sendResponse);
    }
  }

  async function handleRecommendedFilter(items, sendResponse) {
    try {
      const apiConfig = await getApiConfiguration();

      if (!apiConfig.url) {
        throw new Error('API URL not configured');
      }

      if (apiConfig.useOwnApiKey && !apiConfig.apiKey) {
        throw new Error('API key is required when using own OpenRouter key');
      }

      if (!items || items.length === 0) {
        sendResponse({ error: 'No content found on page' });
        return;
      }

      const prompt = PromptTemplates.createRecommendationPrompt(items);

      console.log('Recommendation prompt:\n', prompt);

      const requestBody = {
        model: CONFIG.MODEL,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 1
      };

      if (!apiConfig.useOwnApiKey) {
        requestBody.postCount = items.length;
      }

      const response = await fetch(apiConfig.url, {
        method: 'POST',
        headers: apiConfig.headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);

        if (response.status === 429 && errorData && errorData.error === 'Daily limit exceeded') {
          sendResponse({
            error: 'DAILY_LIMIT_EXCEEDED',
            message: errorData.message,
            dailyLimit: errorData.dailyLimit,
            currentUsage: errorData.currentUsage,
            remaining: errorData.remaining,
            resetTime: errorData.resetTime
          });
          return;
        }

        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      console.log('Recommendation response:\n', JSON.stringify(data, null, 2));

      if (data.choices && data.choices[0]) {
        const recommendation = data.choices[0].message.content.trim();
        sendResponse({ recommendation: recommendation });
      } else {
        throw new Error('Invalid API response: ' + (data.error?.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('❌ Error in handleRecommendedFilter:', error);
      sendResponse({ error: error.message });
    }
  }
})();
