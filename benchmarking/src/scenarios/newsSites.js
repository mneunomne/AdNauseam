import config from '../../config.js';
import {
  installCursor, humanScroll, humanDwell, humanPause,
  clickRandomLink, shouldGoBack, goBack, shuffle,
} from '../humanBehavior.js';

export async function runNewsSitesScenario(page, timeline) {
  const urls = shuffle(config.urls.news);
  const startTime = Date.now();
  const durationMs = config.session.duration * 60 * 1000;
  const cursor = await installCursor(page);

  console.log(`[scenario:news] Starting news sites scenario (${config.session.duration} min)`);

  let siteIndex = 0;

  while (Date.now() - startTime < durationMs) {
    const url = urls[siteIndex % urls.length];
    siteIndex++;

    console.log(`[scenario:news] Visiting: ${url}`);
    timeline.push({ timestamp: Date.now(), event: 'navigate', data: { url } });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(`[scenario:news] Failed to load ${url}: ${e.message}`);
      await humanPause();
      continue;
    }

    // Read the homepage
    await humanScroll(page);
    await humanDwell(page);
    timeline.push({ timestamp: Date.now(), event: 'dwell', data: { url: page.url() } });

    // Click into articles (sub-pages)
    const subPageCount = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < subPageCount; i++) {
      if (Date.now() - startTime >= durationMs) break;

      if (shouldGoBack() && i > 0) {
        await goBack(page);
        timeline.push({ timestamp: Date.now(), event: 'back', data: { url: page.url() } });
      } else {
        const href = await clickRandomLink(page, cursor, { preferInternal: true });
        if (href) {
          timeline.push({ timestamp: Date.now(), event: 'click_link', data: { url: href } });
          await humanScroll(page, { maxScrolls: 15 }); // articles are longer
          await humanDwell(page);
          timeline.push({ timestamp: Date.now(), event: 'dwell', data: { url: page.url() } });
        }
      }
    }

    // Pause before next site
    await humanPause();
  }

  console.log(`[scenario:news] Scenario complete. Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
}
