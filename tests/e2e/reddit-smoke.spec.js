const {
  test,
  expect,
  openTestPage,
  sendMessageToActiveTab,
  waitForLastApiRequest,
} = require('./fixtures/extension-fixture');
const { loadReddit } = require('./helpers/site-fixtures');
const { isLiveMode } = require('./helpers/test-mode');

test.describe('Reddit smoke tests', () => {
  test('filters feed items and includes media metadata', async ({ context, serviceWorker }) => {
    const { page, bridgePage } = await openTestPage(context, serviceWorker, loadReddit, {
      filteringEnabled: false,
      allowedTopics: ['block politics'],
      sendImages: true,
    });

    // Kick off filtering using the current test topics and verify the extension acked it.
    const startResponse = await sendMessageToActiveTab(serviceWorker, {
      action: 'startFiltering',
      topics: ['block politics'],
    }, bridgePage);
    expect(startResponse?.success).toBe(true);

    const totalPosts = await page.locator('shreddit-post[data-gf-state]').count();
    expect(totalPosts).toBeGreaterThan(0);

    const blockedPosts = await page.locator('shreddit-post[data-gf-state="blocked"]').count();
    expect(blockedPosts).toBeGreaterThan(0);

    const lastRequest = await waitForLastApiRequest(serviceWorker, bridgePage);
    expect(lastRequest).toBeDefined();
    expect(lastRequest.body).toBeDefined();

    const messageContent = lastRequest.body.messages?.[0]?.content;
    expect(messageContent).toBeDefined();

    const normalizedEntries = Array.isArray(messageContent)
      ? messageContent
      : [{ type: 'text', text: String(messageContent) }];

    // Vision payloads are only guaranteed in fixture mode because live posts vary.
    const mediaEntries = normalizedEntries.filter(entry => entry.type === 'image_url');
    if (!isLiveMode()) {
      expect(mediaEntries.length).toBeGreaterThan(0);
    }

    // Stop filtering and confirm the DOM returns to its unfiltered state.
    await sendMessageToActiveTab(serviceWorker, { action: 'stopFiltering' }, bridgePage);
    await page.waitForFunction(
      () => document.querySelectorAll('[data-gf-state]').length === 0
    );
  });
});
