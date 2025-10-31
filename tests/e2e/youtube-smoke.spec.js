const {
  test,
  expect,
  openTestPage,
  getStoredState,
  sendMessageToActiveTab,
  waitForLastApiRequest,
} = require('./fixtures/extension-fixture');
const { loadYouTube } = require('./helpers/site-fixtures');
const { isLiveMode } = require('./helpers/test-mode');

test.describe('YouTube smoke tests', () => {
  test('filters initial grid items and processes new content', async ({ context, serviceWorker }) => {
    const { page, bridgePage } = await openTestPage(context, serviceWorker, loadYouTube, {
      filteringEnabled: false,
      allowedTopics: ['block politics'],
    });

    if (isLiveMode()) {
      // Ensure the dynamic data bootstrap is present before continuing.
      await page.waitForFunction(() => typeof window !== 'undefined' && !!window.ytInitialData, {
        timeout: 30000,
      });

      // Wait for at least one video card so the downstream assertions don't race.
      await page.waitForFunction(
        () => document.querySelectorAll('ytd-rich-grid-media, ytd-video-renderer').length > 0,
        { timeout: 40000 }
      );
    }

    const startResponse = await sendMessageToActiveTab(serviceWorker, {
      action: 'startFiltering',
      topics: ['block politics'],
    }, bridgePage);
    expect(startResponse?.success).toBe(true);

    await page.waitForFunction(() => document.querySelector('[data-gf-state]'), {
      timeout: isLiveMode() ? 20000 : 5000,
    });

    const totalItems = await page.locator('[data-gf-state]').count();
    expect(totalItems).toBeGreaterThan(0);

    const blockedCount = await page.locator('[data-gf-state="blocked"]').count();
    expect(blockedCount).toBeGreaterThan(0);

    const allowedCount = await page.locator('[data-gf-state="allowed"]').count();
    expect(allowedCount).toBeGreaterThan(0);

    const blockedTitle = await page.locator('[data-gf-state="blocked"]').first().getAttribute('title');
    expect(blockedTitle).toContain('Blocked:');

    if (!isLiveMode()) {
      const newTitle = 'Politics late night special';
      await page.evaluate(title => {
        const container = document.createElement('ytd-rich-grid-media');
        const titleElement = document.createElement('yt-formatted-string');
        titleElement.id = 'video-title';
        titleElement.textContent = title;
        container.appendChild(titleElement);
        document.body.appendChild(container);
      }, newTitle);

      await page.evaluate(() => window.dispatchEvent(new Event('scroll')));

      const newCard = page.locator('ytd-rich-grid-media').last();
      await expect(newCard).toHaveAttribute('data-gf-state', 'allowed', { timeout: 5000 });
    }

    const stored = await getStoredState(serviceWorker, ['globalApiRequestCount'], bridgePage);
    expect(stored.globalApiRequestCount).toBeGreaterThanOrEqual(3);

    await waitForLastApiRequest(serviceWorker, bridgePage);

    // Ask the extension for a recommended filter and confirm the mocked response.
    const recommendationResponse = await sendMessageToActiveTab(serviceWorker, {
      action: 'getRecommendedFilter',
    }, bridgePage);

    expect(recommendationResponse.recommendation).toBe('Block politics');
  });
});
