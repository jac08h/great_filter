console.log('🔍 Great Filter: Hacker News content script loaded');

class HackerNewsContentFilter extends ContentFilterBase {
  constructor() {
    super();
  }

  extractItemElements() {
    console.log('🔍 DEBUG: Starting extractItemElements()');
    const itemElements = [];
    const processedContainers = new Set();

    const containerSelectors = [
      'tr.athing.submission',
      'tr.athing',
      'table tr.athing'
    ];

    console.log('🔍 DEBUG: Container selectors:', containerSelectors);

    containerSelectors.forEach((selector, index) => {
      console.log(`🔍 DEBUG: Checking selector ${index + 1}: ${selector}`);
      const containers = document.querySelectorAll(selector);
      console.log(`🔍 DEBUG: Found ${containers.length} containers for selector: ${selector}`);

      containers.forEach((container, containerIndex) => {
        if (processedContainers.has(container)) {
          console.log(`🔍 DEBUG: Skipping already processed container for selector: ${selector}`);
          return;
        }
        processedContainers.add(container);

        console.log(`🔍 DEBUG: Processing container ${containerIndex + 1} for selector: ${selector}`);

        const titleSelectors = [
          '.titleline a',
          '.title a',
          '.storylink',
          'td.title a',
          '.athing .title a'
        ];

        let titleElement = null;
        let usedSelector = null;

        titleSelectors.forEach(titleSelector => {
          if (!titleElement) {
            titleElement = container.querySelector(titleSelector);
            if (titleElement) {
              usedSelector = titleSelector;
              console.log(`🔍 DEBUG: Found title element with selector: ${titleSelector}`);
            }
          }
        });

        if (titleElement) {
          let title = titleElement.textContent?.trim() || titleElement.innerText?.trim();

          if (title && title.length > 5) {
            console.log(`🔍 DEBUG: Extracted title: "${title}" (selector: ${usedSelector})`);

            if (!this.processedItems.has(title)) {
              console.log(`🔍 DEBUG: Adding new story: "${title}"`);

              const relatedElements = this.getStoryElements(container);

              itemElements.push({
                title: title,
                container: container,
                itemElements: relatedElements,
                titleElement: titleElement,
                usedSelector: usedSelector
              });
            } else {
              console.log(`🔍 DEBUG: Skipping already processed story: "${title}"`);
            }
          } else {
            console.log(`🔍 DEBUG: Title too short or empty: "${title}"`);
          }
        } else {
          console.log('🔍 DEBUG: No title element found in container');
        }
      });
    });

    console.log(`🔍 DEBUG: Total story elements found: ${itemElements.length}`);
    return itemElements;
  }

  getStoryElements(titleRow) {
    const elements = [titleRow];

    let nextSibling = titleRow.nextElementSibling;
    while (nextSibling) {
      if (nextSibling.classList.contains('athing') && nextSibling.classList.contains('submission')) {
        break;
      }

      elements.push(nextSibling);
      nextSibling = nextSibling.nextElementSibling;

      if (nextSibling && nextSibling.classList.contains('spacer')) {
        elements.push(nextSibling);
        break;
      }
    }

    return elements;
  }

  blurWaitingElement(element) {
    if (element.itemElements) {
      element.itemElements.forEach(el => {
        if (!el.style.filter) {
          el.style.filter = `blur(${VISUAL_EFFECTS.BLUR_RADIUS}) grayscale(${VISUAL_EFFECTS.GRAYSCALE_AMOUNT}) brightness(${VISUAL_EFFECTS.BRIGHTNESS_LEVEL})`;
          el.style.opacity = VISUAL_EFFECTS.WAITING_OPACITY;
          el.style.pointerEvents = 'none';
        }
      });
      console.log('⏳ Great Filter: Applied heavy waiting blur to story elements:', element.title);
    } else {
      super.blurWaitingElement(element.container, element.title);
    }
  }

  blurBlockedElement(element) {
    if (element.itemElements) {
      element.itemElements.forEach(el => {
        el.style.filter = `blur(${VISUAL_EFFECTS.BLUR_RADIUS}) grayscale(${VISUAL_EFFECTS.GRAYSCALE_AMOUNT}) brightness(${VISUAL_EFFECTS.BRIGHTNESS_LEVEL})`;
        el.style.opacity = VISUAL_EFFECTS.BLOCKED_OPACITY;
        el.style.pointerEvents = 'none';
      });
      console.log('🚫 Great Filter: Applied blocked blur to story elements:', element.title);
    } else {
      super.blurBlockedElement(element.container, element.title);
    }
  }

  unblurElement(element) {
    if (element.itemElements) {
      element.itemElements.forEach(el => {
        el.style.filter = '';
        el.style.opacity = VISUAL_EFFECTS.ALLOWED_OPACITY;
        el.style.pointerEvents = '';
      });
      console.log('✅ Great Filter: Removed blur from story elements:', element.title);
    } else {
      super.unblurElement(element.container);
    }
  }

  async processElementsBatch(elements, topics, elementType = 'story') {
    console.log(`🚀 DEBUG: Starting processElementsBatch for ${elementType}s`);
    console.log('🚀 DEBUG: Topics provided:', topics);

    try {
      if (elements.length === 0) {
        console.log(`❌ Great Filter: No new ${elementType}s found`);
        return;
      }

      console.log(`🚀 Great Filter: Processing ${elements.length} ${elementType}s in single batch`);

      this.statistics.totalPosts += elements.length;
      console.log('📊 DEBUG: Incremented totalPosts by', elements.length, 'new total:', this.statistics.totalPosts);

      elements.forEach(element => {
        this.processedItems.add(element.title);
        this.blurWaitingElement(element);
      });

      console.log(`📡 DEBUG: Sending batch of ${elements.length} ${elementType}s to background script`);

      const response = await chrome.runtime.sendMessage({
        action: 'checkItemTitlesBatch',
        items: elements.map((element, index) => ({
          index: index + 1,
          title: element.title,
          container: element.container
        })),
        topics: topics
      });

      console.log('📡 DEBUG: Batch response received:', response);

      if (response.error) {
        console.error(`❌ Great Filter: Error checking ${elementType}s:`, response.error);
        return;
      }

      console.log(`🎯 DEBUG: Applying batch results to ${elementType}s`);
      response.results.forEach((result, index) => {
        const element = elements[index];
        if (result.isAllowed) {
          this.statistics.shownPosts++;
          this.unblurElement(element);
          console.log(`✅ Great Filter: ${elementType} ${index + 1} allowed: "${element.title}"`);
        } else {
          this.statistics.filteredPosts++;
          this.blurBlockedElement(element);
          console.log(`🚫 Great Filter: ${elementType} ${index + 1} blocked: "${element.title}"`);
        }
      });

      this.sendStatsUpdate();

      console.log(`🎉 DEBUG: Finished processing all ${elementType}s in batch`);
    } catch (error) {
      console.error(`❌ Great Filter: Error in processElementsBatch for ${elementType}s:`, error);
    }
  }


  async processItemsForFiltering(topics) {
    const itemElements = this.extractItemElements();

    if (itemElements.length > 0) {
      chrome.runtime.sendMessage({
        action: 'contentProcessing'
      });

      await this.processElementsBatch(itemElements, topics, 'item');

      chrome.runtime.sendMessage({
        action: 'filteringComplete'
      });
    }
  }

  init() {
    console.log('🔍 DEBUG: Initial story element check...');
    this.extractItemElements();

    this.setupMessageListener(
      (topics) => this.processItemsForFiltering(topics),
      (topics) => this.startScrollMonitoring(topics, () => this.extractItemElements(), 'item')
    );

    this.waitForElements(
      () => this.extractItemElements(),
      () => {
        this.checkFilteringState(
          (topics) => this.processItemsForFiltering(topics),
          (topics) => this.startScrollMonitoring(topics, () => this.extractItemElements(), 'item')
        );
      }
    );

    console.log('🔍 Great Filter: Ready for Hacker News filtering with auto-start support!');
  }
}

const hackerNewsFilter = new HackerNewsContentFilter();
hackerNewsFilter.init();
