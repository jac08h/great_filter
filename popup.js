// Constants are now imported from shared/content-base.js
const storageGet = (...args) => window.GFBrowser.storageGet(...args);
const storageSet = (...args) => window.GFBrowser.storageSet(...args);
const tabsQuery = (...args) => window.GFBrowser.tabsQuery(...args);
const tabsSendMessage = (...args) => window.GFBrowser.tabsSendMessage(...args);
const runtimeSendMessage = (...args) => window.GFBrowser.runtimeSendMessage(...args);

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
  const modelSelect = document.getElementById('modelSelect');

  const imageSendingToggle = document.getElementById('imageSendingToggle');
  const imageSendingOption = document.getElementById('imageSendingOption');

  let isFiltering = false;
  let isOnSupportedSite = false;
  let isTopicsEditing = false;
  let usageInfo = null;

  loadSavedTopics();
  loadApiKeySettings();
  loadModelSettings();
  loadImageSendingSettings();
  loadTheme();
  checkCurrentFilteringState();
  checkSupportedSite();
  initializeTooltipContent();
  displayVersion();

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

  modelSelect.addEventListener('change', function() {
    handleModelChange();
  });

  imageSendingToggle.addEventListener('change', function() {
    handleImageSendingChange();
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
      const result = await storageGet(['darkMode']);
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
      await storageSet({ darkMode: isDark });
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  }

  async function startFilteringAction() {
    const result = await storageGet(['allowedTopics']);
    const topics = result.allowedTopics || [];

    if (topics.length === 0) {
      showMessage('Please configure topics first', true);
      return;
    }

    try {
      await storageSet({
        filteringEnabled: true
      });

      startFiltering();

      const tabs = await tabsQuery({active: true, currentWindow: true});
      if (tabs?.[0]) {
        try {
          await tabsSendMessage(tabs[0].id, {
            action: 'startFiltering',
            topics: topics
          });
        } catch (error) {
          console.error('Error starting filter:', error);
          showMessage('Error starting filter. Make sure you are on a supported website.', true);
          stopFiltering();
          return;
        }

        runtimeSendMessage({
          action: 'filteringStarted',
          topics: topics
        }).catch(() => {});
      }
    } catch (error) {
      console.error('Error starting filter:', error);
      showMessage('Error starting filter. Make sure you are on a supported website.', true);
      stopFiltering();
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
      console.log('💾 Saving topics:', topics);
      await setAllowedTopics(topics);
      // Verify save worked
      const verification = await getAllowedTopics();
      console.log('✅ Topics saved and verified:', verification);

      originalTopics = topicsText;
      currentTopicsArray = topics;
      exitTopicsEditMode();
      updateTopicsDisplay();
      showMessage('Topics saved!', false);
      // Ensure active pages pick up the new topics without a manual toggle
      if (isFiltering) {
        const tabs = await tabsQuery({active: true, currentWindow: true});
        if (tabs?.[0]) {
          try {
            await tabsSendMessage(tabs[0].id, {
              action: 'updatePreferences',
              topics
            });
            showMessage('Filtering updated with new topics!');
          } catch (error) {
            console.error('Error updating preferences:', error);
            showMessage('Error updating active tab. Please refresh the page.', true);
          }
        }
      }
    } catch (error) {
      console.error('Error saving topics:', error);
      showMessage('Error saving topics', true);
    }
  }

  async function saveApiKeyImmediate() {
    const apiKey = apiKeyInput.value.trim();
    const useOwnApiKey = useOwnApiKeyRadio.checked;

    try {
      await storageSet({
        apiKey: apiKey
      });

      console.log('API key saved:', { useOwnApiKey, hasApiKey: !!apiKey });
    } catch (error) {
      console.error('Error saving API key:', error);
    }
  }

  async function loadSavedTopics() {
    try {
      const topics = await getAllowedTopics();
      console.log('📖 Loading topics, result:', topics);
      if (topics && topics.length > 0) {
        console.log('✅ Topics loaded:', topics);
        currentTopicsArray = topics;
        const topicsText = topics.join('\n');
        topicsTextarea.value = topicsText;
        originalTopics = topicsText;
        updateTopicsDisplay();
        autoResizeTextarea();
      } else {
        console.log('⚠️ No topics found in storage');
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
      const result = await storageGet(['useOwnApiKey', 'apiKey']);
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

  async function loadImageSendingSettings() {
    try {
      const result = await storageGet(['sendImages', 'useOwnApiKey']);
      const useOwnApiKey = result.useOwnApiKey === true;

      let sendImages = result.sendImages;
      if (sendImages === undefined) {
        sendImages = false;
        await storageSet({ sendImages: false });
      } else {
        sendImages = sendImages === true;
      }

      imageSendingToggle.checked = sendImages;
      updateImageSendingState();
    } catch (error) {
      console.error('Error loading image sending settings:', error);
    }
  }

  function updateImageSendingState() {
    const useOwnApiKey = useOwnApiKeyRadio.checked;

    if (useOwnApiKey) {
      imageSendingToggle.disabled = false;
      imageSendingOption.classList.remove('disabled');
    } else {
      imageSendingToggle.disabled = true;
      imageSendingOption.classList.add('disabled');
    }
  }

  async function handleImageSendingChange() {
    try {
      const sendImages = imageSendingToggle.checked;
      await storageSet({ sendImages });
      console.log('Image sending setting updated:', sendImages);
    } catch (error) {
      console.error('Error saving image sending setting:', error);
    }
  }

  async function checkCurrentFilteringState() {
    try {
      const result = await storageGet(['filteringEnabled', 'allowedTopics']);
      const filteringEnabled = result.filteringEnabled === true;
      const topics = result.allowedTopics || [];

      if (filteringEnabled && topics.length > 0) {
        const tabs = await tabsQuery({active: true, currentWindow: true});
        if (tabs?.[0]) {
          try {
            const response = await tabsSendMessage(tabs[0].id, {
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
      const result = await storageGet(['allowedTopics', 'filteringEnabled']);
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
      await storageSet({
        filteringEnabled: false
      });

      const tabs = await tabsQuery({active: true, currentWindow: true});
      if (tabs?.[0]) {
        await tabsSendMessage(tabs[0].id, {
          action: 'stopFiltering'
        });

        runtimeSendMessage({
          action: 'filteringStopped'
        }).catch(() => {});
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

  async function fetchProxyModel() {
    try {
      const response = await fetch(CONFIG.PROXY_URL, {
        method: 'GET'
      });
      if (response.ok) {
        const data = await response.json();
        return data.model;
      }
    } catch (error) {
      console.error('Error fetching proxy model:', error);
    }
    return null;
  }

  async function loadModelSettings() {
    try {
      modelSelect.innerHTML = '';

      const result = await storageGet(['selectedModel', 'useOwnApiKey']);
      const selectedModel = result.selectedModel || CONFIG.MODEL;
      const useOwnApiKey = result.useOwnApiKey === true;

      if (!useOwnApiKey) {
        const proxyModel = await fetchProxyModel();
        const defaultOption = document.createElement('option');
        defaultOption.value = 'default';
        defaultOption.textContent = proxyModel ? `Default (${proxyModel})` : 'Default';
        modelSelect.appendChild(defaultOption);
        modelSelect.value = 'default';
      } else {
        CONFIG.AVAILABLE_MODELS.forEach(model => {
          const option = document.createElement('option');
          option.value = model;
          option.textContent = model;
          modelSelect.appendChild(option);
        });
        modelSelect.value = selectedModel;
      }

      modelSelect.disabled = !useOwnApiKey;

      updateModelSelectState();
    } catch (error) {
      console.error('Error loading model settings:', error);
    }
  }

  async function handleModelChange() {
    const selectedModel = modelSelect.value;
    try {
      await storageSet({
        selectedModel: selectedModel
      });
      console.log('Model updated:', selectedModel);
    } catch (error) {
      console.error('Error updating model:', error);
    }
  }

  async function updateModelSelectState() {
    const useOwnApiKey = useOwnApiKeyRadio.checked;
    const modelSection = document.getElementById('modelSection');

    modelSelect.disabled = !useOwnApiKey;

    if (!useOwnApiKey) {
      modelSection.classList.add('disabled');
      modelSelect.innerHTML = '';
      const proxyModel = await fetchProxyModel();
      const defaultOption = document.createElement('option');
      defaultOption.value = 'default';
      defaultOption.textContent = proxyModel ? `Default (${proxyModel})` : 'Default';
      modelSelect.appendChild(defaultOption);
      modelSelect.value = 'default';
    } else {
      modelSection.classList.remove('disabled');
      modelSelect.innerHTML = '';
      CONFIG.AVAILABLE_MODELS.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
      });
      const result = await storageGet(['selectedModel']);
      const selectedModel = result.selectedModel || CONFIG.MODEL;
      modelSelect.value = selectedModel;
    }
  }

  async function handleApiChoiceChange() {
    updateApiKeyVisibility();
    updateApiDescription();
    updateModelSelectState();
    updateImageSendingState();

    if (useProxyApiRadio.checked) {
      console.log('🔄 Switched to free tier - checking usage...');
      checkUsageAvailability();

      imageSendingToggle.checked = false;
      modelSelect.value = CONFIG.MODEL;
      try {
        await storageSet({
          sendImages: false,
          selectedModel: CONFIG.MODEL
        });
      } catch (error) {
        console.error('Error resetting proxy settings:', error);
      }
      console.log('Image sending disabled and model reset to default due to free tier selection');
    }

    try {
      await storageSet({
        useOwnApiKey: useOwnApiKeyRadio.checked
      });
      console.log('API choice updated:', useOwnApiKeyRadio.checked ? 'own' : 'proxy');
    } catch (error) {
      console.error('Error updating API choice:', error);
    }
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
      const tabs = await tabsQuery({active: true, currentWindow: true});
      if (tabs?.[0]) {
        const url = tabs[0].url;
        isOnSupportedSite = isSupportedWebsite(url);
        updateMainToggleState();
      } else {
        isOnSupportedSite = false;
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

      const tabs = await tabsQuery({active: true, currentWindow: true});
      if (!tabs?.[0]) {
        showMessage('No active tab found', true);
        recommendBtn.disabled = false;
        recommendBtn.textContent = '💡';
        return;
      }

      const response = await tabsSendMessage(tabs[0].id, {
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

  function displayVersion() {
    const versionNumber = document.getElementById('versionNumber');
    if (versionNumber) {
      versionNumber.textContent = `v${CONFIG.VERSION}`;
      versionNumber.addEventListener('click', function(e) {
        e.preventDefault();
        chrome.tabs.create({ url: ABOUT_CONTENT.CHANGELOG_URL });
      });
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
      aboutDescription.innerHTML = ABOUT_CONTENT.DESCRIPTION;
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

async function setAllowedTopics(topics) {
  try {
    await storageSet({ allowedTopics: topics });
  } catch (error) {
    console.error('Error saving topics to storage, falling back to localStorage:', error);
    localStorage.setItem('allowedTopics', JSON.stringify(topics));
  }
}

async function getAllowedTopics() {
  try {
    const result = await storageGet(['allowedTopics']);
    if (result.allowedTopics) {
      return result.allowedTopics;
    }
  } catch (error) {
    const raw = localStorage.getItem('allowedTopics');
    if (raw) {
      return JSON.parse(raw);
    }
  }
  return [];
}
