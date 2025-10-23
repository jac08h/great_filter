
const POLLING_INTERVALS = {
  STARTUP_ELEMENT_CHECK: 50,           // How often to check for elements during page load (ms)
  STARTUP_MAX_ATTEMPTS: 50,            // Maximum attempts to find elements during startup
  SCROLL_ACTIVE: 100,                  // Fast polling during active scrolling (ms)
  SCROLL_IDLE: 2000,                   // Slow polling when not scrolling (ms)
  SCROLL_ACTIVITY_TIMEOUT: 2000,       // Time to wait before considering scrolling "stopped" (ms)
};

const VISUAL_EFFECTS = {
  BLUR_RADIUS: '6px',                  // Blur intensity for filtered content
  GRAYSCALE_AMOUNT: '100%',            // Grayscale level for filtered content
  BRIGHTNESS_LEVEL: '0.2',             // Brightness reduction for filtered content
  WAITING_OPACITY: '0.8',              // Opacity while waiting for AI response
  BLOCKED_OPACITY: '0.2',              // Opacity for blocked content (visible but dimmed)
  ALLOWED_OPACITY: '',                 // Opacity for allowed content (normal)
};

const UI_TIMEOUTS = {
  POPUP_MESSAGE_DISPLAY: 3000,         // How long popup messages stay visible (ms)
};

const ABOUT_CONTENT = {
  TITLE: 'About',
  DESCRIPTION: 'AI-powered content filtering for social media platforms. ',
  HOW_IT_WORKS_TITLE: 'How It Works',
  HOW_IT_WORKS: 'The extension extracts visible content of individual posts from web pages and sends it to an LLM along with your topic preferences. The LLM decides whether each piece of content should be displayed. Only content approved by the LLM remains visible.',
  API_TIERS_TITLE: 'API Tiers',
  SUPPORTED_SITES_TITLE: 'Supported Sites',
  SUPPORTED_SITES: 'YouTube, Hacker News, Reddit, and X',
  CREDITS_TITLE: 'Credits',
  CREDITS: '<a href="https://jakubhalmes.com/" target="_blank" style="color: #3b82f6; text-decoration: underline;">Jakub Halmeš</a> & Claude via <a href="https://www.anthropic.com/claude-code" target="_blank" style="color: #3b82f6; text-decoration: underline;">Claude Code</a>',
  CHANGELOG_TITLE: 'Changelog'
};

const API_DESCRIPTIONS = {
  FREE_TIER: 'No API key required. Shared daily limit across all users.',
  FREE_TIER_TITLE: 'Free (Limited)',
  YOUR_API_KEY: 'Use your <a href="https://openrouter.ai" target="_blank" style="color: #3b82f6; text-decoration: underline;">OpenRouter</a> API key for unlimited usage.',
  YOUR_API_KEY_TOOLTIP: 'Your API Key'
};

const FEEDBACK_CONTENT = {
  TITLE: 'Feedback',
  DESCRIPTION: 'Enjoying the extension or have ideas for improvement? Your feedback is appreciated!',
  REVIEW_TEXT: 'Leave a review on the Chrome Web Store',
  OR_TEXT: 'or',
  FORM_TEXT: 'Fill out anonymous feedback form',
  FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLScGn0NmNMZYvo-kDZK5JzdELkQhcS7N16TJUoqN6psUxpfZBA/viewform?usp=header'
};

const CHANGELOG = {
  '1.1.0': {
    title: 'Version 1.1.0',
    changes: [
      'UI redesign with light/dark theme support',
      'Add AI filtering recommendations',
      'Switch model to google/gemini-2.5-flash-lite-preview-09-2025',
      'Update filtering prompt',
      'Update polling intervals',
      'Add feedback form',
    ]
  }
};

const TITLE_PREFIXES = {
  PROCESSING: 'Processing:',
  BLOCKED: 'Blocked:',
  ALLOWED: 'Allowed:',
};

class ContentFilterBase {
  constructor() {
    this.processedItems = new Set();
    this.scrollTimeout = null;
    this.currentTopics = null;
    this.isFilteringActive = false;
    this.pollingInterval = null;
    this.lastScrollTime = 0;
    this.isScrollActive = false;
    this.scrollActivityTimeout = null;
    this.extractElementsFunction = null;
  }


  blurWaitingElement(container, title) {
    if (!container.classList.contains('gf-waiting')) {
      container.classList.remove('gf-blocked', 'gf-allowed');
      container.classList.add('gf-waiting');
      container.setAttribute('data-gf-state', 'waiting');
      container.title = `${TITLE_PREFIXES.PROCESSING} ${title}`;
    }
  }

  blurBlockedElement(container, title) {
    container.classList.remove('gf-waiting', 'gf-allowed');
    container.classList.add('gf-blocked');
    container.setAttribute('data-gf-state', 'blocked');
    container.title = `${TITLE_PREFIXES.BLOCKED} ${title}`;
  }

  unblurElement(container) {
    container.classList.remove('gf-waiting', 'gf-blocked');
    container.classList.add('gf-allowed');
    container.setAttribute('data-gf-state', 'allowed');
    container.title = `${TITLE_PREFIXES.ALLOWED} Element kept`;
  }

  async processElements(elements, topics = null) {
    try {
      if (elements.length === 0) {
        return;
      }

      const topicsToUse = topics || this.currentTopics;
      if (!topicsToUse) {
        console.error('❌ Great Filter: No topics available for filtering');
        return;
      }

      elements.forEach(element => {
        this.processedItems.add(element.title);
        this.blurWaitingElement(element.container, element.title);
      });

      chrome.runtime.sendMessage({ action: 'contentProcessing' });

      const response = await chrome.runtime.sendMessage({
        action: 'checkItemTitlesBatch',
        items: elements.map((element, index) => ({
          index: index + 1,
          title: element.title,
          container: element.container
        })),
        topics: topicsToUse
      });

      if (response.error) {
        if (response.error === 'DAILY_LIMIT_EXCEEDED') {
          console.warn('🚫 Great Filter: Daily limit exceeded:', response.message);
          this.showDailyLimitMessage(response);
          this.isFilteringActive = false;
          chrome.runtime.sendMessage({ action: 'filteringStopped' });
          chrome.runtime.sendMessage({ action: 'filteringComplete' });
          return;
        }
        console.error('❌ Great Filter: Error checking items:', response.error);
        chrome.runtime.sendMessage({ action: 'filteringComplete' });
        return;
      }

      response.results.forEach((result, index) => {
        const element = elements[index];
        if (result.isAllowed) {
          this.unblurElement(element.container);
        } else {
          this.blurBlockedElement(element.container, element.title);
        }
      });

      chrome.runtime.sendMessage({ action: 'filteringComplete' });

    } catch (error) {
      console.error('❌ Great Filter: Error in processElements:', error);
      chrome.runtime.sendMessage({ action: 'filteringComplete' });
    }
  }


  startScrollMonitoring(topics, extractElementsFunction, elementType = 'item') {
    this.currentTopics = topics;
    this.extractElementsFunction = extractElementsFunction;

    this.pollingInterval = setInterval(() => {
      this.pollForNewContent();
    }, this.isScrollActive ? POLLING_INTERVALS.SCROLL_ACTIVE : POLLING_INTERVALS.SCROLL_IDLE);

    window.addEventListener('scroll', () => this.updateScrollActivity());

  }

  stopScrollMonitoring() {
    this.currentTopics = null;
    this.extractElementsFunction = null;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.scrollActivityTimeout) {
      clearTimeout(this.scrollActivityTimeout);
      this.scrollActivityTimeout = null;
    }

    window.removeEventListener('scroll', this.updateScrollActivity);

  }


  stopFiltering() {
    this.isFilteringActive = false;
    this.stopScrollMonitoring();

    // Remove all filter classes and attributes from filtered content
    const filteredElements = document.querySelectorAll('[data-gf-state]');
    filteredElements.forEach(element => {
      element.classList.remove('gf-waiting', 'gf-blocked', 'gf-allowed');
      element.removeAttribute('data-gf-state');
      // Only remove our custom titles
      const title = element.getAttribute('title');
      if (title && (title.startsWith(TITLE_PREFIXES.PROCESSING) || title.startsWith(TITLE_PREFIXES.BLOCKED) || title.startsWith(TITLE_PREFIXES.ALLOWED))) {
        element.removeAttribute('title');
      }
    });

    // Clear processed items so they can be reprocessed if filtering is turned back on
    this.processedItems.clear();
  }

  waitForElements(extractElementsFunction, callback, maxAttempts = POLLING_INTERVALS.STARTUP_MAX_ATTEMPTS, interval = POLLING_INTERVALS.STARTUP_ELEMENT_CHECK) {
    let attempts = 0;

    const poll = () => {
      attempts++;
      const elements = extractElementsFunction();

      if (elements && elements.length > 0) {
        callback();
      } else if (attempts < maxAttempts) {
        setTimeout(poll, interval);
      } else {
        callback();
      }
    };

    poll();
  }

  updateScrollActivity() {
    this.lastScrollTime = Date.now();

    if (!this.isScrollActive) {
      this.isScrollActive = true;
      this.adjustPollingInterval();
    }

    clearTimeout(this.scrollActivityTimeout);
    this.scrollActivityTimeout = setTimeout(() => {
      this.isScrollActive = false;
      this.adjustPollingInterval();
    }, POLLING_INTERVALS.SCROLL_ACTIVITY_TIMEOUT);
  }

  adjustPollingInterval() {
    if (!this.pollingInterval) return;

    clearInterval(this.pollingInterval);

    const interval = this.isScrollActive ? POLLING_INTERVALS.SCROLL_ACTIVE : POLLING_INTERVALS.SCROLL_IDLE;

    this.pollingInterval = setInterval(() => {
      this.pollForNewContent();
    }, interval);
  }

  async pollForNewContent() {
    if (!this.currentTopics || !this.extractElementsFunction) return;

    const allElements = this.extractElementsFunction();
    const newElements = allElements.filter(element => !this.processedItems.has(element.title));

    if (newElements.length > 0) {
      await this.processElements(newElements);
    }
  }

  async checkFilteringState() {
    try {
      const result = await chrome.storage.local.get(['allowedTopics', 'filteringEnabled']);
      const topics = result.allowedTopics || [];
      const filteringEnabled = result.filteringEnabled === true;

      if (topics.length > 0 && filteringEnabled) {
        this.isFilteringActive = true;
        await this.processInitialElements(topics);
        this.startScrollMonitoring(topics, () => this.extractItemElements());
      }
    } catch (error) {
      console.error('Error checking filtering state:', error);
    }
  }

  async processInitialElements(topics) {
    const elements = this.extractItemElements();
    if (elements.length > 0) {
      await this.processElements(elements, topics);
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

      if (request.action === 'startFiltering') {
        this.isFilteringActive = true;
        this.processInitialElements(request.topics).then(() => {
          this.startScrollMonitoring(request.topics, () => this.extractItemElements());
          sendResponse({ success: true });
        });
        return true;
      }

      if (request.action === 'stopFiltering') {
        this.stopFiltering();
        sendResponse({ success: true });
      }

      if (request.action === 'getFilteringState') {
        sendResponse({
          isActive: this.isFilteringActive,
          topics: this.currentTopics
        });
      }

      if (request.action === 'getRecommendedFilter') {
        this.getRecommendedFilter().then(result => {
          sendResponse(result);
        }).catch(error => {
          sendResponse({ error: error.message });
        });
        return true;
      }

      return true;
    });
  }

  showDailyLimitMessage(errorResponse) {
    const message = document.createElement('div');
    message.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #dc2626;
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      max-width: 400px;
      line-height: 1.4;
    `;

    const resetTime = errorResponse.resetTime ?
      new Date(errorResponse.resetTime).toLocaleString(undefined, {
        hour: 'numeric',
        minute: '2-digit'
      }) : 'midnight UTC';

    message.innerHTML = `
      <div style="font-size: 12px; opacity: 0.8; margin-bottom: 4px;">Great Filter</div>
      <div style="font-weight: 600; margin-bottom: 8px;">⚠️ Global Daily Quota Reached</div>
      <div style="margin-bottom: 8px;">Resets at ${resetTime}.</div>
      <div style="font-size: 12px; opacity: 0.9;">
        Use your own OpenRouter API key for unlimited access.
      </div>
    `;

    document.body.appendChild(message);

    setTimeout(() => {
      if (message.parentNode) {
        message.parentNode.removeChild(message);
      }
    }, 10000);
  }

  async getRecommendedFilter() {
    try {
      if (this.isFilteringActive) {
        return { error: 'AI recommendations are only available when filtering is disabled' };
      }

      if (typeof this.extractItemElements !== 'function') {
        console.error('❌ extractItemElements method not available');
        return {};
      }

      const elements = this.extractItemElements();

      if (!elements || elements.length === 0) {
        return {};
      }

      const limitedElements = elements.slice(0, CONFIG.MAX_RECOMMENDATION_ITEMS);

      console.log(`Found ${elements.length} content items, using ${limitedElements.length} for recommendation`);

      const items = limitedElements.map(element => ({
        title: element.title
      }));

      const response = await chrome.runtime.sendMessage({
        action: 'getRecommendedFilter',
        items: items
      });

      if (response.error) {
        return { error: response.error };
      }

      return { recommendation: response.recommendation };
    } catch (error) {
      console.error('❌ Error getting recommended filter:', error);
      return { error: error.message };
    }
  }
}

window.ContentFilterBase = ContentFilterBase;
