/*******************************************************************************
    AdNauseam MV3 - Popup Menu Script

    Handles the AdNauseam popup (extension icon click).
    Maps state buttons to MV3 filtering modes:
      - Strict  → MODE_COMPLETE (3) — maximum blocking
      - Active  → MODE_OPTIMAL (2)  — standard blocking
      - Off     → MODE_NONE (0)     — no blocking
*******************************************************************************/

const MODE_NONE = 0;
const MODE_OPTIMAL = 2;
const MODE_COMPLETE = 3;

const stateToLevel = {
  strict: MODE_COMPLETE,
  active: MODE_OPTIMAL,
  disable: MODE_NONE,
};

const levelToState = {
  [MODE_NONE]: 'disable',
  1: 'active',             // MODE_BASIC → treat as active
  [MODE_OPTIMAL]: 'active',
  [MODE_COMPLETE]: 'strict',
};

let currentTab = null;
let currentHostname = '';
let currentLevel = MODE_OPTIMAL;

/******************************************************************************/
// DOM helpers

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/******************************************************************************/
// Messaging

function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

/******************************************************************************/
// Stats

async function updateStats() {
  try {
    const stats = await sendMessage({ what: 'getAdNauseamStats' });
    if (stats) {
      $('#visited').textContent = stats.totalClicks || 0;
      $('#found').textContent = stats.totalAds || 0;
    }
  } catch (e) {
    console.warn('[ADN Menu] Stats error:', e);
  }
}

/******************************************************************************/
// Ad list

let showingRecent = false;

async function renderAdList() {
  const list = $('#ad-list-items');
  const alert = $('#alert-noads');

  let ads = [];
  showingRecent = false;

  try {
    if (currentTab && currentTab.url) {
      const result = await sendMessage({
        what: 'adsForPage',
        pageUrl: currentTab.url
      });

      if (result) {
        ads = result.data || [];
        showingRecent = !!result.recent;

        // Update stats from page response too (includes global totals)
        if (result.total !== undefined) {
          $('#found').textContent = result.total;
        }
        if (result.clicked !== undefined) {
          $('#visited').textContent = result.clicked;
        }
      }
    }
  } catch (e) {
    console.warn('[ADN Menu] Ad list error:', e);
  }

  list.innerHTML = '';

  if (!ads || ads.length === 0) {
    alert.classList.remove('hide');
    alert.querySelector('p').textContent = 'No ads collected yet';
    return;
  }

  if (showingRecent) {
    alert.classList.remove('hide');
    alert.querySelector('p').textContent = 'No ads on this page — showing recent';
  } else {
    alert.classList.add('hide');
  }

  for (const ad of ads) {
    list.appendChild(createAdElement(ad));
  }
}

function createAdElement(ad) {
  const li = document.createElement('li');
  li.className = 'ad-item ' + adStatusClass(ad);
  li.id = 'ad' + ad.id;

  const isImg = ad.contentType === 'img';
  const src = isImg ? (ad.contentData && ad.contentData.src) : null;
  const title = ad.title || (ad.contentData && ad.contentData.title) || 'Ad #' + ad.id;

  // Thumbnail
  const thumb = document.createElement('span');
  thumb.className = 'thumb';
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.className = 'ad-item-img';
    img.onerror = function() {
      this.style.display = 'none';
      thumb.textContent = '?';
      thumb.classList.add('text-thumb');
    };
    thumb.appendChild(img);
  } else {
    thumb.textContent = ad.contentType === 'text' ? 'T' : '?';
    thumb.classList.add('text-thumb');
  }
  li.appendChild(thumb);

  // Info
  const info = document.createElement('div');
  info.className = 'ad-info';

  const titleEl = document.createElement('span');
  titleEl.className = 'ad-title';
  titleEl.textContent = title.substring(0, 60);
  info.appendChild(titleEl);

  // Show page origin domain (where the ad was found), not target
  const cite = document.createElement('cite');
  cite.textContent = pageDomain(ad);
  info.appendChild(cite);

  const status = document.createElement('span');
  status.className = 'ad-status ' + adStatusClass(ad);
  status.textContent = adStatusLabel(ad);
  info.appendChild(status);

  li.appendChild(info);
  return li;
}

function adStatusClass(ad) {
  if (ad.visitedTs > 0) return 'visited';
  if (ad.visitedTs < 0) return 'failed';
  if (ad.noVisit) return 'skipped';
  return 'pending';
}

function adStatusLabel(ad) {
  if (ad.visitedTs > 0) return 'visited';
  if (ad.visitedTs < 0) return 'failed';
  if (ad.noVisit) return 'skipped';
  return 'pending';
}

function targetDomain(ad) {
  try {
    return new URL(ad.resolvedTargetUrl || ad.targetUrl).hostname;
  } catch {
    return ad.targetDomain || '';
  }
}

function pageDomain(ad) {
  if (ad.pageDomain) return ad.pageDomain;
  try {
    return new URL(ad.pageUrl).hostname;
  } catch {
    return '';
  }
}

/******************************************************************************/
// State buttons (Strict / Active / Off)

function setActiveState(state) {
  $$('.state-btn').forEach(btn => btn.classList.remove('selected'));
  const btn = $(`.state-btn[data-state="${state}"]`);
  if (btn) btn.classList.add('selected');

  // Update body class for styling
  document.body.className = state === 'disable' ? 'disabled' : state;
}

async function commitState(state) {
  const level = stateToLevel[state];
  if (level === undefined) return;

  setActiveState(state);

  try {
    // Set filtering mode for current hostname
    const hostname = currentHostname || 'all-urls';
    const actualLevel = await sendMessage({
      what: 'setFilteringMode',
      hostname,
      level,
    });

    currentLevel = actualLevel !== undefined ? actualLevel : level;

    // Reload current tab if mode changed
    if (currentTab && currentTab.id) {
      chrome.tabs.reload(currentTab.id);
    }
  } catch (e) {
    console.warn('[ADN Menu] Mode change error:', e);
  }
}

/******************************************************************************/
// Event listeners

function setupEvents() {
  // State buttons
  $$('.state-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      commitState(btn.dataset.state);
    });
  });

  // uBlock button → open original uBOLite popup in new tab
  $('#btn-ublock').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup-ubol.html') });
    window.close();
  });

  // Settings → open dashboard
  $('#btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Vault button → placeholder (will open vault page later)
  $('#vault-button').addEventListener('click', () => {
    // TODO: open vault.html when implemented
    chrome.tabs.create({ url: chrome.runtime.getURL('popup-ubol.html') });
    window.close();
  });

  // AdNauseam logo → open website
  $('#toggle-button').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://adnauseam.io' });
    window.close();
  });

  // Listen for ad updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.what === 'adDetected' || msg.what === 'adVisited') {
      updateStats();
      renderAdList();
    }
  });
}

/******************************************************************************/
// Init

async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTab = tab;
    try {
      const url = new URL(tab.url);
      currentHostname = url.hostname;
    } catch {}
  }

  // Get current filtering mode
  try {
    const response = await sendMessage({
      what: 'popupPanelData',
      hostname: currentHostname,
    });
    if (response && response.level !== undefined) {
      currentLevel = response.level;
    }
  } catch {}

  // Set initial state from filtering level
  const state = levelToState[currentLevel] || 'active';
  setActiveState(state);

  // Load stats and ads  
  await updateStats();
  await renderAdList();

  // Periodic refresh
  setInterval(updateStats, 3000);

  setupEvents();
}

init();
