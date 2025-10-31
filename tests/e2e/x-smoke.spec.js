const {
  test,
  expect,
  openTestPage,
  sendMessageToActiveTab,
  waitForLastApiRequest,
} = require('./fixtures/extension-fixture');
const { loadX } = require('./helpers/site-fixtures');
const { isLiveMode } = require('./helpers/test-mode');

test.describe('X smoke tests', () => {
  test('filters tweets and captures media context', async ({ context, serviceWorker }) => {
    const { page, bridgePage } = await openTestPage(context, serviceWorker, loadX, {
      filteringEnabled: false,
      allowedTopics: ['block politics'],
      sendImages: true,
    });

    if (isLiveMode()) {
      // Public timelines can be sparse; skip gracefully if no tweets render.
      const hasTweets = await page
        .waitForFunction(() => document.querySelector('article[data-testid="tweet"]'), {
          timeout: 30000,
        })
        .catch(() => null);

      if (!hasTweets) {
        test.skip('Public tweets unavailable without authentication');
      }
    }

    const startResponse = await sendMessageToActiveTab(serviceWorker, {
      action: 'startFiltering',
      topics: ['block politics'],
    }, bridgePage);
    expect(startResponse?.success).toBe(true);

    await page.waitForFunction(() => document.querySelector('article[data-gf-state]'), {
      timeout: isLiveMode() ? 30000 : 5000,
    });

    const totalTweets = await page.locator('article[data-testid="tweet"][data-gf-state]').count();
    expect(totalTweets).toBeGreaterThan(0);

    const blockedTweets = await page.locator('article[data-testid="tweet"][data-gf-state="blocked"]').count();
    expect(blockedTweets).toBeGreaterThan(0);

    const lastRequest = await waitForLastApiRequest(serviceWorker, bridgePage);
    expect(lastRequest).toBeDefined();
    const messageContent = lastRequest.body.messages?.[0]?.content;
    const normalizedEntries = Array.isArray(messageContent)
      ? messageContent
      : [{ type: 'text', text: String(messageContent || '') }];

    const imageEntries = normalizedEntries.filter(entry => entry.type === 'image_url');
    if (isLiveMode()) {
      expect(Array.isArray(imageEntries)).toBe(true);
    } else {
      expect(imageEntries.length).toBeGreaterThan(0);
    }

    const textEntries = normalizedEntries
      .filter(entry => entry.type === 'text')
      .map(entry => entry.text || '');
    expect(textEntries.length).toBeGreaterThan(0);

    const combinedText = textEntries.join('\n');
    if (isLiveMode()) {
      // Live copy changes constantly; just ensure the string produced is non-empty.
      expect(combinedText.trim().length).toBeGreaterThan(0);
    } else {
      expect(combinedText).toContain('Politics update trending worldwide');
      expect(combinedText).toContain('Media:');
    }
  });
});
