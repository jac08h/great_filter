// Constants are now imported from shared/content-base.js

document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 Popup script loaded!');
  const mainToggle = document.getElementById('mainToggle');
  const topicsDisplay = document.getElementById('topicsDisplay');
  const topicsEdit = document.getElementById('topicsEdit');
  const topicsText = document.getElementById('topicsText');
  const topicsEditBtn = document.getElementById('topicsEditBtn');
  const topicsTextarea = document.getElementById('topics');
  const topicsSaveBtn = document.getElementById('topicsSaveBtn');
  const recommendBtn = document.getElementById('recommendBtn');

  const themeToggle = document.getElementById('themeToggle');

  const settingsIcon = document.getElementById('settingsIcon');
  const infoIcon = document.getElementById('infoIcon');
  const feedbackIcon = document.getElementById('feedbackIcon');

  const settingsView = document.getElementById('settingsView');
  const infoView = document.getElementById('infoView');
  const feedbackView = document.getElementById('feedbackView');

  const settingsBackBtn = document.getElementById('settingsBackBtn');
  const infoBackBtn = document.getElementById('infoBackBtn');
  const feedbackBackBtn = document.getElementById('feedbackBackBtn');

  const useProxyApiRadio = document.getElementById('useProxyApi');
  const useOwnApiKeyRadio = document.getElementById('useOwnApiKey');
  const apiKeySection = document.getElementById('apiKeySection');
  const apiKeyInput = document.getElementById('apiKey');
  const apiDescription = document.getElementById('apiDescription');

  let isFiltering = false;
  let isOnSupportedSite = false;
  let isTopicsEditing = false;
  let usageInfo = null;

  loadSavedTopics();
  loadApiKeySettings();
  loadTheme();
  checkCurrentFilteringState();
  checkSupportedSite();
  initializeTooltipContent();

  let originalTopics = '';
  let currentTopicsArray = [];

  function autoResizeTextarea() {
    topicsTextarea.style.height = '80px';
    const scrollHeight = topicsTextarea.scrollHeight;
    const maxHeight = 120;
    const newHeight = Math.min(scrollHeight, maxHeight);
    topicsTextarea.style.height = newHeight + 'px';
  }

  themeToggle.addEventListener('click', function() {
    toggleTheme();
  });

  settingsIcon.addEventListener('click', function() {
    showView('settings');
  });

  infoIcon.addEventListener('click', function() {
    showView('info');
  });

  feedbackIcon.addEventListener('click', function() {
    showView('feedback');
  });

  settingsBackBtn.addEventListener('click', function() {
    hideAllViews();
  });

  infoBackBtn.addEventListener('click', function() {
    hideAllViews();
  });

  feedbackBackBtn.addEventListener('click', function() {
    hideAllViews();
  });

  mainToggle.addEventListener('click', function() {
    if (!isOnSupportedSite) {
      return;
    }

    if (isFiltering) {
      stopFiltering();
    } else {
      startFilteringAction();
    }
  });

  topicsEditBtn.addEventListener('click', function() {
    enterTopicsEditMode();
  });

  recommendBtn.addEventListener('click', function() {
    getRecommendedFilterFromPage();
  });

  topicsSaveBtn.addEventListener('click', function() {
    if (topicsSaveBtn.classList.contains('active')) {
      saveTopics();
    }
  });

  topicsTextarea.addEventListener('input', function() {
    autoResizeTextarea();
    checkTopicsForChanges();
  });

  useProxyApiRadio.addEventListener('change', function() {
    console.log('📻 Proxy radio clicked, current state:', { checked: useProxyApiRadio.checked });
    handleApiChoiceChange();
  });

  useOwnApiKeyRadio.addEventListener('change', function() {
    console.log('📻 Own API radio clicked, current state:', { checked: useOwnApiKeyRadio.checked });
    handleApiChoiceChange();
  });

  apiKeyInput.addEventListener('input', function() {
    saveApiKeyImmediate();
  });

  const feedbackFormLink = document.getElementById('feedbackFormLink');
  const feedbackReviewLink = document.getElementById('feedbackReviewLink');

  feedbackFormLink.addEventListener('click', function(e) {
    e.preventDefault();
    chrome.tabs.create({
      url: FEEDBACK_CONTENT.FORM_URL
    });
  });

  feedbackReviewLink.addEventListener('click', function(e) {
    e.preventDefault();
    chrome.tabs.create({
      url: 'https://chrome.google.com/webstore/detail/mbifgfgfbnemojmfkckodkikibihcgaj/reviews'
    });
  });

  function checkTopicsForChanges() {
    const currentTopics = topicsTextarea.value.trim();
    const hasChanges = currentTopics !== originalTopics;

    if (hasChanges) {
      topicsSaveBtn.classList.remove('inactive');
      topicsSaveBtn.classList.add('active');
    } else {
      topicsSaveBtn.classList.remove('active');
      topicsSaveBtn.classList.add('inactive');
    }
  }

  function showView(viewName) {
    settingsView.classList.add('hidden');
    infoView.classList.add('hidden');
    feedbackView.classList.add('hidden');

    if (viewName === 'settings') {
      settingsView.classList.remove('hidden');
      if (useProxyApiRadio.checked) {
        checkUsageAvailability();
      }
    } else if (viewName === 'info') {
      infoView.classList.remove('hidden');
    } else if (viewName === 'feedback') {
      feedbackView.classList.remove('hidden');
    }
  }

  function hideAllViews() {
    settingsView.classList.add('hidden');
    infoView.classList.add('hidden');
    feedbackView.classList.add('hidden');
  }

  async function loadTheme() {
    try {
      const result = await chrome.storage.local.get(['darkMode']);
      const darkMode = result.darkMode === true;
      if (darkMode) {
        document.body.classList.add('dark');
        themeToggle.textContent = '☀️';
      } else {
        themeToggle.textContent = '🌙';
      }
    } catch (error) {
      console.error('Error loading theme:', error);
    }
  }

  async function toggleTheme() {
    const isDark = document.body.classList.toggle('dark');
    themeToggle.textContent = isDark ? '☀️' : '🌙';
    try {
      await chrome.storage.local.set({ darkMode: isDark });
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  }

  async function startFilteringAction() {
    const result = await chrome.storage.local.get(['allowedTopics']);
    const topics = result.allowedTopics || [];

    if (topics.length === 0) {
      showMessage('Please configure topics first', true);
      return;
    }

    try {
      await chrome.storage.local.set({
        filteringEnabled: true
      });

      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (tabs[0]) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          action: 'startFiltering',
          topics: topics
        });

        chrome.runtime.sendMessage({
          action: 'filteringStarted',
          topics: topics
        });

        startFiltering();

        await chrome.tabs.reload(tabs[0].id);

        showMessage('Filtering started!');
      }
    } catch (error) {
      console.error('Error starting filter:', error);
      showMessage('Error starting filter. Make sure you are on a supported website.', true);
    }
  }

  async function saveTopics() {
    const topicsText = topicsTextarea.value.trim();
    const topics = topicsText.split('\n').filter(topic => topic.trim() !== '').map(topic => topic.trim());

    if (topics.length === 0) {
      showMessage('Please enter at least one topic', true);
      return;
    }

    try {
      await chrome.storage.local.set({
        allowedTopics: topics
      });

      originalTopics = topicsText;
      currentTopicsArray = topics;
      exitTopicsEditMode();
      updateTopicsDisplay();

      showMessage('Topics saved successfully!');

      // Only update preferences if filtering is currently enabled
      if (isFiltering) {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        if (tabs[0]) {
          try {
            await chrome.tabs.sendMessage(tabs[0].id, {
              action: 'updatePreferences',
              topics: topics
            });
            showMessage('Filtering updated with new preferences!');
          } catch (error) {
            console.error('Error updating preferences:', error);
            showMessage('Error updating preferences. Please refresh the page.', true);
          }
        }
      }

      console.log('Topics saved:', topics);
    } catch (error) {
      console.error('Error saving topics:', error);
      showMessage('Error saving topics: ' + error.message, true);
    }
  }

  async function saveApiKeyImmediate() {
    const apiKey = apiKeyInput.value.trim();
    const useOwnApiKey = useOwnApiKeyRadio.checked;

    try {
      await chrome.storage.local.set({
        apiKey: apiKey
      });

      console.log('API key saved:', { useOwnApiKey, hasApiKey: !!apiKey });
    } catch (error) {
      console.error('Error saving API key:', error);
    }
  }

  async function loadSavedTopics() {
    try {
      const result = await chrome.storage.local.get(['allowedTopics']);
      if (result.allowedTopics && result.allowedTopics.length > 0) {
        currentTopicsArray = result.allowedTopics;
        const topicsText = result.allowedTopics.join('\n');
        topicsTextarea.value = topicsText;
        originalTopics = topicsText;
        updateTopicsDisplay();
        autoResizeTextarea();
      } else {
        currentTopicsArray = [];
        updateTopicsDisplay();
      }
      updateToggleState();
    } catch (error) {
      console.error('Error loading topics:', error);
    }
  }

  async function loadApiKeySettings() {
    try {
      const result = await chrome.storage.local.get(['useOwnApiKey', 'apiKey']);
      const useOwnApiKey = result.useOwnApiKey === true;
      const apiKey = result.apiKey || '';

      if (useOwnApiKey) {
        useOwnApiKeyRadio.checked = true;
        useProxyApiRadio.checked = false;
      } else {
        useProxyApiRadio.checked = true;
        useOwnApiKeyRadio.checked = false;
      }
      apiKeyInput.value = apiKey;

      updateApiKeyVisibility();
      updateApiDescription();
    } catch (error) {
      console.error('Error loading API key settings:', error);
    }
  }

  async function checkCurrentFilteringState() {
    try {
      const result = await chrome.storage.local.get(['filteringEnabled', 'allowedTopics']);
      const filteringEnabled = result.filteringEnabled === true;
      const topics = result.allowedTopics || [];

      if (filteringEnabled && topics.length > 0) {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        if (tabs[0]) {
          try {
            const response = await chrome.tabs.sendMessage(tabs[0].id, {
              action: 'getFilteringState'
            });

            if (response && response.isActive) {
              console.log('Filtering is already active, syncing popup state');
              isFiltering = true;
              startFiltering();
            } else {
              updateToggleState();
            }
          } catch (error) {
            console.log('Could not check filtering state (probably not on supported site):', error);
            updateToggleState();
          }
        } else {
          updateToggleState();
        }
      } else {
        updateToggleState();
      }
    } catch (error) {
      console.error('Error checking filtering state:', error);
      updateToggleState();
    }
  }

  async function updateToggleState() {
    try {
      const result = await chrome.storage.local.get(['allowedTopics', 'filteringEnabled']);
      const topics = result.allowedTopics || [];
      const filteringEnabled = result.filteringEnabled === true;

      if (topics.length > 0 && filteringEnabled && isOnSupportedSite) {
        mainToggle.classList.remove('inactive');
        mainToggle.classList.add('active');
        isFiltering = true;
      } else {
        mainToggle.classList.remove('active');
        mainToggle.classList.add('inactive');
        isFiltering = false;
      }

      updateMainToggleState();
    } catch (error) {
      console.error('Error checking status:', error);
    }
  }

  function startFiltering() {
    isFiltering = true;
    mainToggle.classList.remove('inactive');
    mainToggle.classList.add('active');
    updateMainToggleState();
  }

  async function stopFiltering() {
    isFiltering = false;
    mainToggle.classList.remove('active');
    mainToggle.classList.add('inactive');
    updateMainToggleState();

    try {
      await chrome.storage.local.set({
        filteringEnabled: false
      });

      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (tabs[0]) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          action: 'stopFiltering'
        });

        chrome.runtime.sendMessage({
          action: 'filteringStopped'
        });

        await chrome.tabs.reload(tabs[0].id);
      }
    } catch (error) {
      console.error('Error stopping filter:', error);
    }
  }

  function updateMainToggleState() {
    if (!isOnSupportedSite) {
      mainToggle.style.opacity = '0.5';
      mainToggle.style.cursor = 'not-allowed';
      mainToggle.title = 'Unsupported website';
    } else {
      mainToggle.style.opacity = '1';
      mainToggle.style.cursor = 'pointer';
      mainToggle.title = isFiltering ? 'Stop filtering' : 'Start filtering';
    }
  }

  function enterTopicsEditMode() {
    isTopicsEditing = true;
    topicsDisplay.classList.add('hidden');
    topicsEdit.classList.remove('hidden');
    topicsTextarea.focus();
    autoResizeTextarea();
    checkTopicsForChanges();
  }

  function exitTopicsEditMode() {
    isTopicsEditing = false;
    topicsEdit.classList.add('hidden');
    topicsDisplay.classList.remove('hidden');
    topicsSaveBtn.classList.remove('active');
    topicsSaveBtn.classList.add('inactive');
  }

  function updateTopicsDisplay() {
    if (currentTopicsArray.length > 0) {
      topicsText.textContent = currentTopicsArray.join(', ');
    } else {
      topicsText.textContent = 'No preferences configured';
    }
  }

  function updateApiKeyVisibility() {
    if (useOwnApiKeyRadio.checked) {
      apiKeySection.classList.remove('hidden');
    } else {
      apiKeySection.classList.add('hidden');
    }
  }

  function handleApiChoiceChange() {
    updateApiKeyVisibility();
    updateApiDescription();

    if (useProxyApiRadio.checked) {
      console.log('🔄 Switched to free tier - checking usage...');
      checkUsageAvailability();
    }

    chrome.storage.local.set({
      useOwnApiKey: useOwnApiKeyRadio.checked
    }).then(() => {
      console.log('API choice updated:', useOwnApiKeyRadio.checked ? 'own' : 'proxy');
    }).catch(error => {
      console.error('Error updating API choice:', error);
    });
  }

  function updateApiDescription() {
    console.log('🎨 updateApiDescription called - useOwnApiKey:', useOwnApiKeyRadio.checked, 'usageInfo:', usageInfo);

    if (useOwnApiKeyRadio.checked) {
      apiDescription.innerHTML = API_DESCRIPTIONS.YOUR_API_KEY;
    } else {
      const baseText = API_DESCRIPTIONS.FREE_TIER;

      if (usageInfo) {
        if (usageInfo.hasQueriesAvailable) {
          const newText = `${baseText}\n✅ Available`;
          console.log('🎨 Setting description to (available):', newText);
          apiDescription.textContent = newText;
        } else {
          const resetTime = usageInfo.resetTime ? new Date(usageInfo.resetTime).toLocaleString(undefined, {
            hour: 'numeric',
            minute: '2-digit'
          }) : 'midnight UTC';
          const newText = `${baseText}\n❌ Global daily quota reached. Resets at ${resetTime}.`;
          console.log('🎨 Setting description to (limited):', newText);
          apiDescription.textContent = newText;
        }
      } else {
        console.log('🎨 Setting description to (no usage info):', baseText);
        apiDescription.textContent = baseText;
      }
    }
  }

  function showMessage(text, isError = false) {
    const messageEl = document.createElement('div');
    messageEl.className = isError ? 'message error' : 'message';
    messageEl.textContent = text;
    document.body.appendChild(messageEl);

    setTimeout(() => {
      messageEl.remove();
    }, UI_TIMEOUTS.POPUP_MESSAGE_DISPLAY);
  }

  async function checkSupportedSite() {
    try {
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (tabs[0]) {
        const url = tabs[0].url;
        isOnSupportedSite = isSupportedWebsite(url);
        updateMainToggleState();
      }
    } catch (error) {
      console.error('Error checking supported site:', error);
      isOnSupportedSite = false;
      updateMainToggleState();
    }
  }

  function isSupportedWebsite(url) {
    if (!url) return false;

    const supportedPatterns = [
      /^https:\/\/www\.youtube\.com\/.*/,
      /^https:\/\/news\.ycombinator\.com\/(?!item).*/,
      /^https:\/\/.*\.reddit\.com\/.*/,
      /^https:\/\/x\.com\/.*/
    ];

    return supportedPatterns.some(pattern => pattern.test(url));
  }

  async function getRecommendedFilterFromPage() {
    try {
      if (!isOnSupportedSite) {
        showMessage('Please open a supported website', true);
        return;
      }

      recommendBtn.disabled = true;
      recommendBtn.textContent = '⏳';

      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (!tabs[0]) {
        showMessage('No active tab found', true);
        recommendBtn.disabled = false;
        recommendBtn.textContent = '💡';
        return;
      }

      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        action: 'getRecommendedFilter'
      });

      recommendBtn.disabled = false;
      recommendBtn.textContent = '💡';

      if (response && response.recommendation) {
        topicsTextarea.value = response.recommendation;
        enterTopicsEditMode();
        autoResizeTextarea();
        checkTopicsForChanges();
      } else if (response && response.error) {
        showMessage(response.error, true);
      } else {
        showMessage('Could not get recommendation', true);
      }
    } catch (error) {
      console.error('Error getting recommendation:', error);
      showMessage('Error: ' + error.message, true);
      recommendBtn.disabled = false;
      recommendBtn.textContent = '💡';
    }
  }

  async function checkUsageAvailability() {
    try {
      const usageUrl = 'https://great-filter-vps.vercel.app/api/usage';
      console.log('📡 Making usage request to:', usageUrl);

      const response = await fetch(usageUrl);
      console.log('📡 Usage response status:', response.status);

      if (!response.ok) {
        throw new Error(`Usage check failed: ${response.status}`);
      }

      usageInfo = await response.json();
      console.log('✅ Usage info received:', usageInfo);

      updateApiDescription();
      console.log('🎨 API description updated with usage info');

    } catch (error) {
      console.error('❌ Error checking usage availability:', error);
      usageInfo = null;
      updateApiDescription();
    }
  }

  function initializeTooltipContent() {
    const aboutTitle = document.getElementById('aboutTitle');
    const aboutDescription = document.getElementById('aboutDescription');
    const howItWorksTitle = document.getElementById('howItWorksTitle');
    const howItWorks = document.getElementById('howItWorks');
    const apiTiersTitle = document.getElementById('apiTiersTitle');
    const supportedSitesTitle = document.getElementById('supportedSitesTitle');
    const supportedSites = document.getElementById('supportedSites');
    const creditsTitle = document.getElementById('creditsTitle');
    const credits = document.getElementById('credits');
    const changelogTitle = document.getElementById('changelogTitle');
    const changelogContent = document.getElementById('changelogContent');

    const tooltipFreeTier = document.getElementById('tooltipFreeTier');
    const tooltipFreeTierDesc = document.getElementById('tooltipFreeTierDesc');
    const tooltipYourApiKey = document.getElementById('tooltipYourApiKey');
    const tooltipYourApiKeyDesc = document.getElementById('tooltipYourApiKeyDesc');

    const feedbackTitle = document.getElementById('feedbackTitle');
    const feedbackDescription = document.getElementById('feedbackDescription');
    const feedbackFormText = document.getElementById('feedbackFormText');
    const feedbackOrText = document.getElementById('feedbackOrText');
    const feedbackReviewText = document.getElementById('feedbackReviewText');

    if (aboutTitle) {
      aboutTitle.textContent = ABOUT_CONTENT.TITLE;
    }
    if (aboutDescription) {
      aboutDescription.textContent = ABOUT_CONTENT.DESCRIPTION;
    }
    if (howItWorksTitle) {
      howItWorksTitle.textContent = ABOUT_CONTENT.HOW_IT_WORKS_TITLE;
    }
    if (howItWorks) {
      howItWorks.textContent = ABOUT_CONTENT.HOW_IT_WORKS;
    }
    if (apiTiersTitle) {
      apiTiersTitle.textContent = ABOUT_CONTENT.API_TIERS_TITLE;
    }
    if (supportedSitesTitle) {
      supportedSitesTitle.textContent = ABOUT_CONTENT.SUPPORTED_SITES_TITLE;
    }
    if (supportedSites) {
      supportedSites.textContent = ABOUT_CONTENT.SUPPORTED_SITES;
    }
    if (creditsTitle) {
      creditsTitle.textContent = ABOUT_CONTENT.CREDITS_TITLE;
    }
    if (credits) {
      credits.innerHTML = ABOUT_CONTENT.CREDITS;
    }
    if (changelogTitle) {
      changelogTitle.textContent = ABOUT_CONTENT.CHANGELOG_TITLE;
    }
    if (changelogContent) {
      let changelogHtml = '';
      for (const [version, data] of Object.entries(CHANGELOG)) {
        changelogHtml += `<div class="changelog-version">`;
        changelogHtml += `<h4>${data.title}</h4>`;
        changelogHtml += `<ul>`;
        data.changes.forEach(change => {
          changelogHtml += `<li>${change}</li>`;
        });
        changelogHtml += `</ul></div>`;
      }
      changelogContent.innerHTML = changelogHtml;
    }

    if (tooltipFreeTier) {
      tooltipFreeTier.textContent = API_DESCRIPTIONS.FREE_TIER_TITLE;
    }
    if (tooltipFreeTierDesc) {
      tooltipFreeTierDesc.textContent = API_DESCRIPTIONS.FREE_TIER;
    }
    if (tooltipYourApiKey) {
      tooltipYourApiKey.textContent = API_DESCRIPTIONS.YOUR_API_KEY_TOOLTIP;
    }
    if (tooltipYourApiKeyDesc) {
      tooltipYourApiKeyDesc.innerHTML = API_DESCRIPTIONS.YOUR_API_KEY;
    }

    if (feedbackTitle) {
      feedbackTitle.textContent = FEEDBACK_CONTENT.TITLE;
    }
    if (feedbackDescription) {
      feedbackDescription.textContent = FEEDBACK_CONTENT.DESCRIPTION;
    }
    if (feedbackFormText) {
      feedbackFormText.textContent = FEEDBACK_CONTENT.FORM_TEXT;
    }
    if (feedbackOrText) {
      feedbackOrText.textContent = FEEDBACK_CONTENT.OR_TEXT;
    }
    if (feedbackReviewText) {
      feedbackReviewText.textContent = FEEDBACK_CONTENT.REVIEW_TEXT;
    }
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'filteringStarted') {
      console.log('Auto-filtering started with topics:', request.topics);
      startFiltering();
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    checkSupportedSite();
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url) {
      checkSupportedSite();
    }
  });

});
