const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, firefox, expect, test: base } = require('@playwright/test');
const { withExtension } = require('playwright-webextext');
const { isLiveMode } = require('../helpers/test-mode');
const { isRecommendationRequest } = require('../../../shared/test-utils');

const EXTENSION_PATH = path.resolve(__dirname, '..', '..', '..');
const chromiumWithExtension = withExtension(chromium, EXTENSION_PATH);
const firefoxWithExtension = withExtension(firefox, EXTENSION_PATH);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isFirefoxBridge(serviceWorker) {
  return Boolean(serviceWorker && serviceWorker._gfIsFirefoxBridge);
}

const bridgeTokens = new WeakMap();

async function ensureBridgeReadyOnPage(page) {
  if (!page) {
    throw new Error('Firefox bridge requires an active page instance');
  }

  if (bridgeTokens.has(page)) {
    return bridgeTokens.get(page);
  }

  await page.waitForLoadState('domcontentloaded');

  const token = await page.evaluate(() => {
    if (window.__GF_TEST_BRIDGE_TOKEN__) {
      return window.__GF_TEST_BRIDGE_TOKEN__;
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      function cleanup(result, isError = false) {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', handler);
        clearTimeout(timeoutId);
        if (isError) {
          reject(result);
        } else {
          resolve(result);
        }
      }

      function handler(event) {
        if (event.source !== window) {
          return;
        }

        if (event.data && event.data.type === 'GF_TEST_BRIDGE_READY' && event.data.token) {
          window.__GF_TEST_BRIDGE_TOKEN__ = event.data.token;
          cleanup(event.data.token);
        }
      }

      const timeoutId = setTimeout(() => {
        cleanup(new Error('Timed out waiting for GF test bridge'), true);
      }, 5000);

      window.addEventListener('message', handler);
      window.postMessage({ type: 'GF_TEST_BRIDGE_INIT', id: `gf-init-${Math.random()}` }, '*');
    });
  });

  if (!token) {
    throw new Error('GF test bridge not ready');
  }

  bridgeTokens.set(page, token);
  return token;
}

async function bridgeCommand(page, action, payload) {
  const token = await ensureBridgeReadyOnPage(page);

  return page.evaluate(({ action, payload, token }) => {
    return new Promise((resolve, reject) => {
      const id = `gf-bridge-${Math.random().toString(36).slice(2)}`;

      const timeoutId = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error(`GF bridge action "${action}" timed out`));
      }, 10000);

      function handler(event) {
        if (event.source !== window || !event.data || event.data.type !== 'GF_TEST_BRIDGE_RESPONSE' || event.data.id !== id) {
          return;
        }

        window.removeEventListener('message', handler);
        clearTimeout(timeoutId);

        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.payload);
        }
      }

      window.addEventListener('message', handler);
      window.postMessage({ type: 'GF_TEST_BRIDGE', id, action, payload, token }, '*');
    });
  }, { action, payload, token });
}

async function resolveFirefoxExtensionBaseUrl(profileDir) {
  const defaultStorageDir = path.join(profileDir, 'storage', 'default');
  const prefix = 'moz-extension+++';

  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const entries = await fs.promises.readdir(defaultStorageDir);
      const match = entries.find(name => name.startsWith(prefix));
      if (match) {
        const uuid = match.slice(prefix.length).split('^')[0];
        return `moz-extension://${uuid}`;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    await sleep(200);
  }

  throw new Error('Unable to determine Firefox extension URL from profile data');
}

async function waitForServiceWorker(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (serviceWorker) {
    return serviceWorker;
  }

  serviceWorker = await context.waitForEvent('serviceworker');
  return serviceWorker;
}

async function ensureServiceWorkerActive(context) {
  const serviceWorker = await waitForServiceWorker(context);
  // Establish a ping handler so later tests can confirm the worker is alive.
  await serviceWorker.evaluate(() => {
    if (!self.__gf_pingInitialized) {
      self.__gf_pingInitialized = true;
      self.addEventListener('message', event => {
        if (event.data === 'gf-ping') {
          event.ports[0]?.postMessage('gf-pong');
        }
      });
    }
  });

  return serviceWorker;
}

async function mockApiResponses(serviceWorker, page) {
  if (!isFirefoxBridge(serviceWorker)) {
    await serviceWorker.evaluate((isRecommendationRequestFn) => {
      const originalFetch = self.__gf_originalFetch || fetch;
      self.__gf_originalFetch = originalFetch;

      const isRecommendationRequest = new Function('return ' + isRecommendationRequestFn)();

      // Intercept the extension's fetch calls to keep Playwright runs deterministic.
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

        if (isRecommendationRequest(body)) {
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
    }, isRecommendationRequest.toString());
    return;
  }

  await bridgeCommand(page, 'installMocks');
}

async function seedExtensionState(serviceWorker, overrides = {}, page) {
  const defaultState = {
    filteringEnabled: true,
    allowedTopics: ['block politics'],
    useOwnApiKey: false,
    sendImages: false,
    selectedModel: 'google/gemma-3-12b-it',
    globalApiRequestCount: 0,
    darkMode: false,
  };

  if (!isFirefoxBridge(serviceWorker)) {
    await serviceWorker.evaluate(state => chrome.storage.local.set(state), {
      ...defaultState,
      ...overrides,
    });
    return;
  }

  await bridgeCommand(page, 'setStorage', {
    state: {
      ...defaultState,
      ...overrides,
    },
  });
}

async function clearExtensionState(serviceWorker, page) {
  if (!isFirefoxBridge(serviceWorker)) {
    await serviceWorker.evaluate(() => chrome.storage.local.clear());
    return;
  }

  await bridgeCommand(page, 'clearStorage');
}

async function getExtensionId(serviceWorker) {
  const url = serviceWorker.url();
  const chromeMatch = url.match(/^chrome-extension:\/\/([a-z]+)\//i);
  if (chromeMatch) {
    return chromeMatch[1];
  }
  const firefoxMatch = url.match(/^moz-extension:\/\/([^/]+)/i);
  if (firefoxMatch) {
    return firefoxMatch[1];
  }
  throw new Error(`Could not parse extension ID from URL: ${url}`);
}

async function getFirefoxExtensionIdFromProfile(profileDir) {
  const baseUrl = await resolveFirefoxExtensionBaseUrl(profileDir);
  const [, extensionId] = baseUrl.match(/^moz-extension:\/\/([^/]+)/i) || [];
  if (!extensionId) {
    throw new Error('Unable to determine Firefox extension ID');
  }
  return extensionId;
}

async function sendMessageToActiveTab(serviceWorker, message, page) {
  if (isFirefoxBridge(serviceWorker)) {
    return bridgeCommand(page, 'forwardMessage', message);
  }

  const result = await serviceWorker.evaluate(
    async ({ payload, retries, retryDelay }) => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

      const queryActiveTab = () =>
        new Promise((resolve, reject) => {
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(tabs);
          });
        });

      const sendMessage = tabId =>
        new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, payload, response => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(response);
          });
        });

      const tabs = await queryActiveTab();
      const activeTab = tabs[0];
      if (!activeTab) {
        return { ok: false, error: 'No active tab available to receive message' };
      }

      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const response = await sendMessage(activeTab.id);
          return { ok: true, response };
        } catch (error) {
          if (attempt === retries - 1) {
            return { ok: false, error: error?.message || String(error) };
          }
          await wait(retryDelay);
        }
      }

      return { ok: false, error: 'Failed to send message' };
    },
    {
      payload: message,
      retries: isLiveMode() ? 30 : 10,
      retryDelay: isLiveMode() ? 250 : 150,
    }
  );

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.response;
}

async function sendRuntimeMessage(serviceWorker, message, page) {
  if (isFirefoxBridge(serviceWorker)) {
    const response = await bridgeCommand(page, 'runtimeMessage', { message });
    if (response && response.error) {
      throw new Error(response.error);
    }
    return response?.response;
  }

  const result = await serviceWorker.evaluate(async payload => {
    const callRuntimeMessage = () =>
      new Promise((resolve, reject) => {
        const maybePromise = chrome.runtime.sendMessage(payload, response => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(response);
        });

        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve, reject);
        }
      });

    try {
      const response = await callRuntimeMessage();
      return { ok: true, response };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }, message);

  if (!result.ok) {
    throw new Error(result.error);
  }

  const response = result.response;
  if (response && response.ok === false) {
    throw new Error(response.error || 'Runtime message failed');
  }
  return response;
}

async function waitForLastApiRequest(serviceWorker, page, timeout = 10000) {
  // Poll the worker for the most recent mocked fetch payload so assertions can inspect it.
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const request = isFirefoxBridge(serviceWorker)
      ? (await bridgeCommand(page, 'getLastApiRequest'))?.request || null
      : await serviceWorker.evaluate(() => self.__gf_lastApiRequest || null);
    if (request) {
      return request;
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for API request');
}

async function getStoredState(serviceWorker, keys, page) {
  if (!isFirefoxBridge(serviceWorker)) {
    return serviceWorker.evaluate(requestedKeys => chrome.storage.local.get(requestedKeys), keys);
  }

  const response = await bridgeCommand(page, 'getStorage', { keys });
  return response?.data || {};
}

async function prepareExtensionState(serviceWorker, page, overrides = {}) {
  if (isFirefoxBridge(serviceWorker)) {
    await clearExtensionState(serviceWorker, page);
    await mockApiResponses(serviceWorker, page);
    await seedExtensionState(serviceWorker, overrides, page);
    return;
  }

  await clearExtensionState(serviceWorker);
  await mockApiResponses(serviceWorker);
  await seedExtensionState(serviceWorker, overrides);
}

async function openTestPage(context, serviceWorker, loadPage, overrides = {}) {
  const isBridge = isFirefoxBridge(serviceWorker);

  if (!isBridge) {
    await prepareExtensionState(serviceWorker, undefined, overrides);
  }

  const page = await context.newPage();
  if (typeof loadPage !== 'function') {
    throw new TypeError(`Expected loadPage to be function, received ${typeof loadPage}`);
  }
  await loadPage(page);

  if (isBridge) {
    bridgeTokens.delete(page);
    await ensureBridgeReadyOnPage(page);
    await prepareExtensionState(serviceWorker, page, overrides);
  }

  return {
    page,
    bridgePage: isBridge ? page : undefined,
  };
}

const test = base.extend({
  extensionProfileDir: async ({ browserName }, use) => {
    if (browserName === 'firefox') {
      const profileDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gf-firefox-'));
      try {
        await use(profileDir);
      } finally {
        await fs.promises.rm(profileDir, { recursive: true, force: true });
      }
      return;
    }

    await use('');
  },
  context: async ({ browserName, extensionProfileDir }, use) => {
    // Launch Chromium with the unpacked extension loaded so every test shares the same profile.
    if (browserName === 'chromium') {
      const context = await chromiumWithExtension.launchPersistentContext('', {
        headless: false,
        args: [
          '--no-first-run',
          '--no-default-browser-check',
        ],
      });

      await use(context);
      await context.close();
      return;
    }

    if (browserName === 'firefox') {
      const context = await firefoxWithExtension.launchPersistentContext(extensionProfileDir, {
        headless: false,
      });

      try {
        await use(context);
      } finally {
        await context.close();
      }
      return;
    }

    throw new Error(`Unsupported browser for extension tests: ${browserName}`);
  },
  serviceWorker: async ({ context, browserName }, use) => {
    if (browserName === 'firefox') {
      const bridge = { _gfIsFirefoxBridge: true };
      await use(bridge);
      return;
    }

    const worker = await ensureServiceWorkerActive(context);
    await use(worker);
  },
  extensionId: async ({ serviceWorker, browserName, extensionProfileDir }, use) => {
    if (browserName === 'firefox') {
      const extensionId = await getFirefoxExtensionIdFromProfile(extensionProfileDir);
      await use(extensionId);
      return;
    }

    const extensionId = await getExtensionId(serviceWorker);
    await use(extensionId);
  },
});

module.exports = {
  test,
  expect,
  mockApiResponses,
  seedExtensionState,
  clearExtensionState,
  sendMessageToActiveTab,
  sendRuntimeMessage,
  getStoredState,
  waitForLastApiRequest,
  prepareExtensionState,
  openTestPage,
};
