import { launchBrowser } from './browser.js';
import { DataExtractor } from './dataExtractor.js';
import { Reporter } from './reporter.js';
import { setupAutoDismiss } from './cookieConsent.js';
import { initLogger, attachPageLogger, attachBackgroundLogger, closeLogger } from './logger.js';
import { runNewsSitesScenario } from './scenarios/newsSites.js';
import { runMixedSessionScenario } from './scenarios/mixedSession.js';
import { runCustomUrlsScenario } from './scenarios/customUrls.js';
import config from '../config.js';

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      parsed.scenario = args[++i];
    } else if (args[i] === '--duration' && args[i + 1]) {
      parsed.duration = parseInt(args[++i], 10);
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs();
  const scenario = args.scenario || config.session.scenario;
  if (args.duration) config.session.duration = args.duration;

  // Start logging to file (must be before any console output we want captured)
  const logFile = initLogger(scenario);

  console.log(`[main] AdNauseam Benchmark`);
  console.log(`[main] Scenario: ${scenario}`);
  console.log(`[main] Duration: ${config.session.duration} minutes`);
  console.log(`[main] Log file: ${logFile}`);
  console.log(`[main] Extension: ${config.extensionPath}`);
  console.log(`[main] Profile: ${config.profileDir}`);
  console.log('');

  // Launch browser with extension
  console.log('[main] Launching browser...');
  const { browser, backgroundPage } = await launchBrowser();

  // Attach logger to extension background page (captures [ADN] logs and errors)
  attachBackgroundLogger(backgroundPage);

  // Set up data extraction
  const extractor = new DataExtractor(backgroundPage);
  const reporter = new Reporter(scenario);
  const timeline = [];
  const pageVisits = [];

  // Collect environment info (location, version, browser)
  console.log('[main] Collecting environment info...');
  const env = await extractor.getEnvironment(browser);
  reporter.setEnvironment(env);
  console.log(`[main] AdNauseam v${env.adnauseamVersion} | ${env.browser}`);
  console.log(`[main] Location: ${env.location.city || env.location.timezone}, ${env.location.country || ''}`);
  console.log('');

  // Start periodic data snapshots
  const snapshotInterval = setInterval(async () => {
    try {
      const snapshot = await extractor.takeSnapshot();
      console.log(`[snapshot] Ads: ${snapshot.adCount} | Blocked: ${snapshot.blockingStats?.requestStats?.blockedCount || 0}`);
    } catch (e) {
      console.log(`[snapshot] Error: ${e.message}`);
    }
  }, config.extractionInterval * 1000);

  // Get the first tab (or create one)
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  // Auto-dismiss GDPR/cookie consent banners on every page load
  setupAutoDismiss(page);

  // Attach logger to browsing page (captures JS errors, failed requests)
  attachPageLogger(page, 'tab');

  // Track page visits
  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      if (url && url.startsWith('http')) {
        pageVisits.push({
          url,
          timestamp: Date.now(),
          title: await page.title().catch(() => ''),
        });
      }
    }
  });

  // Run the selected scenario
  try {
    switch (scenario) {
      case 'news':
        await runNewsSitesScenario(page, timeline);
        break;
      case 'mixed':
        await runMixedSessionScenario(page, timeline);
        break;
      case 'custom':
        await runCustomUrlsScenario(page, timeline);
        break;
      default:
        console.error(`[main] Unknown scenario: ${scenario}. Use: news, mixed, custom`);
        process.exit(1);
    }
  } catch (e) {
    console.error(`[main] Scenario error: ${e.message}`);
    console.error(e.stack);
  }

  // Stop snapshots
  clearInterval(snapshotInterval);

  // Take final snapshot
  await extractor.takeSnapshot();

  // Collect final results
  console.log('\n[main] Collecting final results...');
  const results = await extractor.getFinalResults();

  // Get page performance for the last page
  const perfMetrics = await extractor.getPageMetrics(page);
  if (perfMetrics) {
    results.lastPageMetrics = perfMetrics;
  }

  // Report
  reporter.printSummary(results, pageVisits);
  const filepath = reporter.save(results, timeline, pageVisits);
  reporter.saveSummary(results, pageVisits);

  // Close browser
  console.log('[main] Closing browser...');
  await browser.close();
  console.log(`[main] Done. Results: ${filepath}`);

  // Close log file
  const finalLogPath = closeLogger();
  // Use original console since logger is closed
  process.stdout.write(`[main] Log saved to: ${finalLogPath}\n`);
}

main().catch(e => {
  console.error('[main] Fatal error:', e);
  process.exit(1);
});
