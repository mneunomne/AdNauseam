import fs from 'fs';
import config from '../../config.js';
import {
  installCursor, humanScroll, humanDwell, humanPause,
  clickRandomLink, shouldGoBack, goBack, shuffle,
} from '../humanBehavior.js';

export async function runCustomUrlsScenario(page, timeline) {
  let urls;
  try {
    const raw = fs.readFileSync(config.customUrlsFile, 'utf-8');
    urls = JSON.parse(raw);
  } catch (e) {
    console.error(`[scenario:custom] Failed to read custom URLs from ${config.customUrlsFile}: ${e.message}`);
    console.error('[scenario:custom] Create urls/custom.json with an array of URL strings');
    return;
  }

  if (!Array.isArray(urls) || urls.length === 0) {
    console.error('[scenario:custom] urls/custom.json must be a non-empty array of URLs');
    return;
  }

  const startTime = Date.now();
  const durationMs = config.session.duration * 60 * 1000;
  const cursor = await installCursor(page);
  const shuffledUrls = shuffle(urls);

  console.log(`[scenario:custom] Starting custom URL scenario (${urls.length} URLs, ${config.session.duration} min)`);

  let urlIndex = 0;

  while (Date.now() - startTime < durationMs && urlIndex < shuffledUrls.length) {
    const url = shuffledUrls[urlIndex];
    urlIndex++;

    console.log(`[scenario:custom] Visiting: ${url}`);
    timeline.push({ timestamp: Date.now(), event: 'navigate', data: { url } });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(`[scenario:custom] Failed to load ${url}: ${e.message}`);
      await humanPause();
      continue;
    }

    // Browse the page
    await humanScroll(page);
    await humanDwell(page);
    timeline.push({ timestamp: Date.now(), event: 'dwell', data: { url: page.url() } });

    // Sub-page navigation
    const subPageCount = Math.floor(Math.random() * config.behavior.subPageClicks.max) + 1;
    for (let i = 0; i < subPageCount; i++) {
      if (Date.now() - startTime >= durationMs) break;

      if (shouldGoBack() && i > 0) {
        await goBack(page);
        timeline.push({ timestamp: Date.now(), event: 'back', data: { url: page.url() } });
      } else {
        const href = await clickRandomLink(page, cursor, { preferInternal: true });
        if (href) {
          timeline.push({ timestamp: Date.now(), event: 'click_link', data: { url: href } });
          await humanScroll(page);
          await humanDwell(page);
          timeline.push({ timestamp: Date.now(), event: 'dwell', data: { url: page.url() } });
        }
      }
    }

    await humanPause();
  }

  console.log(`[scenario:custom] Scenario complete. Visited ${urlIndex} URLs in ${Math.round((Date.now() - startTime) / 1000)}s`);
}
