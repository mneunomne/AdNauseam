import config from '../../config.js';
import {
  installCursor, humanScroll, humanDwell, humanPause,
  clickRandomLink, performSearch, shouldGoBack, goBack, shuffle,
} from '../humanBehavior.js';

export async function runMixedSessionScenario(page, timeline) {
  const startTime = Date.now();
  const durationMs = config.session.duration * 60 * 1000;
  const cursor = await installCursor(page);

  const sites = shuffle(config.urls.mixed);
  const queries = shuffle(config.searchQueries);

  console.log(`[scenario:mixed] Starting mixed browsing scenario (${config.session.duration} min)`);

  let siteIndex = 0;
  let queryIndex = 0;

  while (Date.now() - startTime < durationMs) {
    // Alternate between direct site visits and search engine queries
    // 50% chance of doing a search (high ad yield from Google text ads)
    const doSearch = Math.random() < 0.5 && queryIndex < queries.length;

    if (doSearch) {
      // Pick a search engine and search for something
      const searchEngine = config.urls.search[Math.floor(Math.random() * config.urls.search.length)];
      const query = queries[queryIndex % queries.length];
      queryIndex++;

      console.log(`[scenario:mixed] Searching on ${searchEngine}`);
      timeline.push({ timestamp: Date.now(), event: 'navigate', data: { url: searchEngine } });

      try {
        await page.goto(searchEngine, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await humanPause();
        const searched = await performSearch(page, cursor, query);

        if (searched) {
          timeline.push({ timestamp: Date.now(), event: 'search', data: { query, engine: searchEngine } });
          await humanScroll(page, { maxScrolls: 5 });
          await humanDwell(page);

          // Click a search result
          const href = await clickRandomLink(page, cursor, { preferInternal: false });
          if (href) {
            timeline.push({ timestamp: Date.now(), event: 'click_link', data: { url: href } });
            await humanScroll(page);
            await humanDwell(page);
            timeline.push({ timestamp: Date.now(), event: 'dwell', data: { url: page.url() } });
          }
        }
      } catch (e) {
        console.log(`[scenario:mixed] Search failed: ${e.message}`);
      }
    } else {
      // Visit a site directly
      const url = sites[siteIndex % sites.length];
      siteIndex++;

      console.log(`[scenario:mixed] Visiting: ${url}`);
      timeline.push({ timestamp: Date.now(), event: 'navigate', data: { url } });

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        console.log(`[scenario:mixed] Failed to load ${url}: ${e.message}`);
        await humanPause();
        continue;
      }

      // Browse the page
      await humanScroll(page);
      await humanDwell(page);
      timeline.push({ timestamp: Date.now(), event: 'dwell', data: { url: page.url() } });

      // Navigate into sub-pages
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
    }

    await humanPause();
  }

  console.log(`[scenario:mixed] Scenario complete. Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
}
