import { createCursor } from 'ghost-cursor';
import config from '../config.js';

const { behavior } = config;

// --- Utility functions ---

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(randomBetween(min, max + 1));
}

// Gaussian random using Box-Muller transform
function gaussianRandom(mean, stddev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * stddev + mean;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Human behavior primitives ---

export async function installCursor(page) {
  const cursor = createCursor(page);
  return cursor;
}

/**
 * Simulate human-like scrolling on the page.
 * Scrolls down with variable speed and pauses, occasionally scrolls up.
 */
export async function humanScroll(page, options = {}) {
  const { maxScrolls = 10, scrollDownProbability = 0.85 } = options;
  const scrollCount = randomInt(3, maxScrolls);

  for (let i = 0; i < scrollCount; i++) {
    const direction = Math.random() < scrollDownProbability ? 1 : -1;
    const distance = randomInt(behavior.scrollStep.min, behavior.scrollStep.max) * direction;

    try {
      await page.evaluate((dist) => {
        window.scrollBy({ top: dist, behavior: 'smooth' });
      }, distance);
    } catch {
      // Page navigated or context destroyed mid-scroll
      return;
    }

    // Pause between scrolls (reading simulation)
    const pause = randomBetween(behavior.scrollPause.min, behavior.scrollPause.max);
    await sleep(pause);
  }
}

/**
 * Wait on a page simulating reading time.
 * Uses gaussian distribution around the configured mean.
 */
export async function humanDwell(page) {
  const { min, max, mean } = behavior.dwellTime;
  const stddev = (max - min) / 4;
  const seconds = clamp(gaussianRandom(mean, stddev), min, max);
  console.log(`[human] Dwelling for ${Math.round(seconds)}s`);
  await sleep(seconds * 1000);
}

/**
 * Wait between page navigations.
 */
export async function humanPause() {
  const seconds = randomBetween(behavior.betweenPages.min, behavior.betweenPages.max);
  await sleep(seconds * 1000);
}

/**
 * Click a random visible link on the page using ghost-cursor for realistic movement.
 * Prefers internal links (same domain) for sub-page navigation.
 * Returns the href of the clicked link, or null if no suitable link found.
 */
export async function clickRandomLink(page, cursor, options = {}) {
  const { preferInternal = true, maxAttempts = 3 } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const links = await page.evaluate((prefInternal) => {
        const currentHost = window.location.hostname;
        const allLinks = Array.from(document.querySelectorAll('a[href]'));

        // Filter to visible, reasonable links
        const visible = allLinks.filter(a => {
          const rect = a.getBoundingClientRect();
          const style = window.getComputedStyle(a);
          const href = a.href;
          return rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            href.startsWith('http') &&
            !href.includes('#') &&
            !href.match(/\.(pdf|zip|exe|dmg|pkg|deb|rpm)$/i) &&
            a.textContent.trim().length > 0;
        });

        if (visible.length === 0) return [];

        let candidates;
        if (prefInternal) {
          const internal = visible.filter(a => {
            try { return new URL(a.href).hostname === currentHost; }
            catch { return false; }
          });
          candidates = internal.length > 3 ? internal : visible;
        } else {
          candidates = visible;
        }

        // Return info about random candidates (pick a few for selection)
        const selected = [];
        const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, 5);
        for (const a of shuffled) {
          const rect = a.getBoundingClientRect();
          selected.push({
            href: a.href,
            text: a.textContent.trim().slice(0, 50),
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            selector: getUniqueSelector(a),
          });
        }
        return selected;

        function getUniqueSelector(el) {
          if (el.id) return `#${el.id}`;
          const path = [];
          while (el && el.nodeType === 1) {
            let selector = el.tagName.toLowerCase();
            if (el.id) { path.unshift(`#${el.id}`); break; }
            const sibling = el.parentNode ? Array.from(el.parentNode.children) : [];
            if (sibling.length > 1) {
              const idx = sibling.indexOf(el) + 1;
              selector += `:nth-child(${idx})`;
            }
            path.unshift(selector);
            el = el.parentNode;
          }
          return path.join(' > ');
        }
      }, preferInternal);

      if (links.length === 0) {
        console.log('[human] No suitable links found on page');
        return null;
      }

      // Pick one at random
      const target = links[randomInt(0, links.length - 1)];
      console.log(`[human] Clicking link: "${target.text}" → ${target.href}`);

      // Use ghost-cursor for realistic mouse movement to the element
      try {
        await cursor.click(target.selector, {
          paddingPercentage: 10, // slight offset from center
          waitForClick: randomInt(50, 200),
        });
      } catch {
        // Fallback: direct click if ghost-cursor can't find element
        await page.click(target.selector);
      }

      // Wait for navigation
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      return target.href;
    } catch (e) {
      if (attempt === maxAttempts - 1) {
        console.log(`[human] Failed to click link after ${maxAttempts} attempts: ${e.message}`);
        return null;
      }
      await sleep(1000);
    }
  }
  return null;
}

/**
 * Type text in a human-like way with random delays between characters.
 */
export async function humanType(page, selector, text) {
  await page.click(selector);
  await sleep(randomBetween(200, 500));

  for (const char of text) {
    await page.keyboard.type(char, {
      delay: randomInt(behavior.typingDelay.min, behavior.typingDelay.max),
    });

    // Occasional longer pause (thinking)
    if (Math.random() < 0.05) {
      await sleep(randomBetween(300, 800));
    }
  }
}

/**
 * Perform a search on a search engine page.
 */
export async function performSearch(page, cursor, query) {
  // Try common search input selectors
  const searchSelectors = [
    'input[name="q"]',
    'input[type="search"]',
    'input[aria-label*="Search"]',
    'input[aria-label*="search"]',
    '#search-input',
    '.search-input',
  ];

  for (const selector of searchSelectors) {
    try {
      const input = await page.$(selector);
      if (input) {
        console.log(`[human] Searching for: "${query}"`);
        await cursor.click(selector);
        await sleep(randomBetween(300, 700));
        await humanType(page, selector, query);
        await sleep(randomBetween(500, 1000));
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        return true;
      }
    } catch {
      continue;
    }
  }
  console.log('[human] No search input found on page');
  return false;
}

/**
 * Decide whether to go back or continue forward.
 */
export function shouldGoBack() {
  return Math.random() < behavior.backButtonProbability;
}

/**
 * Navigate back.
 */
export async function goBack(page) {
  console.log('[human] Going back');
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await sleep(randomBetween(1000, 3000));
}

/**
 * Shuffle array in place (Fisher-Yates).
 */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
