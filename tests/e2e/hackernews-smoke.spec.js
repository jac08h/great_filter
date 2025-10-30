const {
  test,
  expect,
  openTestPage,
  getStoredState,
  sendMessageToActiveTab,
  waitForLastApiRequest,
} = require('./fixtures/extension-fixture');
const { loadHackerNews } = require('./helpers/site-fixtures');

test.describe('Hacker News smoke tests', () => {
  test('filters story rows and restores state after DOM changes', async ({ context, serviceWorker }) => {
    const { page, bridgePage } = await openTestPage(context, serviceWorker, loadHackerNews, {
      filteringEnabled: false,
      allowedTopics: ['block politics'],
    });

    // Trigger filtering and confirm the content script acknowledged the request.
    const startResponse = await sendMessageToActiveTab(serviceWorker, {
      action: 'startFiltering',
      topics: ['block politics'],
    }, bridgePage);
    expect(startResponse?.success).toBe(true);

    const containerCount = await page.evaluate(() => document.querySelectorAll('tr.athing').length);
    expect(containerCount).toBeGreaterThan(0);

    await page.waitForFunction(() => document.querySelector('tr.gf-blocked, tr.gf-allowed') !== null);

    const usage = await getStoredState(serviceWorker, ['globalApiRequestCount'], bridgePage);

    const totalRows = await page.locator('tr.gf-blocked, tr.gf-allowed').count();
    expect(totalRows).toBeGreaterThanOrEqual(2);

    const blockedRows = await page.locator('tr.gf-blocked').count();
    expect(blockedRows).toBeGreaterThanOrEqual(1);

    await page.evaluate(() => {
      document
        .querySelectorAll('tr.gf-blocked, tr.gf-allowed, tr.gf-waiting')
        .forEach(element => {
          element.classList.remove('gf-blocked', 'gf-allowed', 'gf-waiting');
        });
    });

    // The rerender logic should notice cleared classes and reapply the filtering state.
    await page.waitForFunction(() => {
      const elements = Array.from(document.querySelectorAll('tr'));
      return elements.some(el => el.classList.contains('gf-blocked'));
    });

    await waitForLastApiRequest(serviceWorker, bridgePage);

    const storage = await getStoredState(serviceWorker, ['globalApiRequestCount'], bridgePage);
    expect(storage.globalApiRequestCount).toBeGreaterThanOrEqual(2);
  });
});
