const path = require('path');
const { chromium, expect, test: base } = require('@playwright/test');
const { isLiveMode } = require('../helpers/test-mode');

const EXTENSION_PATH = path.resolve(__dirname, '..', '..', '..');

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

async function mockApiResponses(serviceWorker) {
  await serviceWorker.evaluate(() => {
    const originalFetch = self.__gf_originalFetch || fetch;
    self.__gf_originalFetch = originalFetch;

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

      const messageContent = body.messages?.[0]?.content;
      const isRecommendationRequest = (() => {
        if (typeof messageContent === 'string') {
          return messageContent.toLowerCase().includes('suggest');
        }
        if (Array.isArray(messageContent)) {
          return messageContent.some(entry =>
            entry?.type === 'text' && entry?.text?.toLowerCase().includes('suggest')
          );
        }
        return false;
      })();

      if (isRecommendationRequest) {
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
          prompt_tokens: 10 * itemCount,
          completion_tokens: 8 * itemCount,
          total_tokens: 18 * itemCount,
        },
      };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });
}

async function seedExtensionState(serviceWorker, overrides = {}) {
  const defaultState = {
    filteringEnabled: true,
    allowedTopics: ['block politics'],
    useOwnApiKey: false,
    sendImages: false,
    selectedModel: 'google/gemma-3-12b-it',
    globalApiRequestCount: 0,
    darkMode: false,
  };

  await serviceWorker.evaluate(state => chrome.storage.local.set(state), {
    ...defaultState,
    ...overrides,
  });
}

async function clearExtensionState(serviceWorker) {
  await serviceWorker.evaluate(() => chrome.storage.local.clear());
}

async function getExtensionId(serviceWorker) {
  const [, extensionId] = serviceWorker.url().match(/^chrome-extension:\/\/([a-z]+)\//i) || [];
  if (!extensionId) {
    throw new Error(`Could not parse extension ID from URL: ${serviceWorker.url()}`);
  }
  return extensionId;
}

async function openExtensionPopup(context, extensionId) {
  // Create a dedicated page pointed at popup.html so tests can interact with UI controls.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded',
  });
  return popup;
}

async function sendMessageToActiveTab(serviceWorker, message) {
  const result = await serviceWorker.evaluate(
    async ({ payload, retries, retryDelay }) => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

      // Live pages can take a while to attach content scripts; retry until they respond.
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab) {
        return { ok: false, error: 'No active tab available to receive message' };
      }

      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const response = await chrome.tabs.sendMessage(activeTab.id, payload);
          return { ok: true, response };
        } catch (error) {
          if (attempt === retries - 1) {
            return { ok: false, error: error?.message || String(error) };
          }
          await sleep(retryDelay);
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

async function sendRuntimeMessage(serviceWorker, message) {
  const result = await serviceWorker.evaluate(async payload => {
    try {
      const response = await chrome.runtime.sendMessage(payload);
      return { ok: true, response };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }, message);

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.response;
}

async function waitForLastApiRequest(serviceWorker, timeout = 10000) {
  // Poll the worker for the most recent mocked fetch payload so assertions can inspect it.
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const request = await serviceWorker.evaluate(() => self.__gf_lastApiRequest || null);
    if (request) {
      return request;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for API request');
}

async function getStoredState(serviceWorker, keys) {
  return serviceWorker.evaluate(requestedKeys => chrome.storage.local.get(requestedKeys), keys);
}

const test = base.extend({
  context: async ({}, use) => {
    // Launch Chromium with the unpacked extension loaded so every test shares the same profile.
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker = await ensureServiceWorkerActive(context);
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
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
  openExtensionPopup,
  sendMessageToActiveTab,
  sendRuntimeMessage,
  getStoredState,
  waitForLastApiRequest,
};
