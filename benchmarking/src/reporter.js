import fs from 'fs';
import path from 'path';
import config from '../config.js';

export class Reporter {
  constructor(scenario) {
    this.scenario = scenario;
    this.startTime = Date.now();
  }

  /**
   * Save the full benchmark results to a JSON file.
   */
  save(results, timeline, pageVisits) {
    fs.mkdirSync(config.resultsDir, { recursive: true });

    const endTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `benchmark-${this.scenario}-${timestamp}.json`;
    const filepath = path.join(config.resultsDir, filename);

    const report = {
      meta: {
        scenario: this.scenario,
        startTime: new Date(this.startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        durationSeconds: Math.round((endTime - this.startTime) / 1000),
        configuredDurationMinutes: config.session.duration,
      },
      pages: pageVisits,
      ads: results.summary,
      adsByDomain: this.summarizeDomains(results.adsByDomain),
      blocking: results.blockingStats,
      performance: {
        snapshots: results.snapshots,
        adGrowthOverTime: this.computeAdGrowth(results.snapshots),
      },
      timeline,
      allAds: results.allAds,
    };

    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    console.log(`\n[reporter] Results saved to: ${filepath}`);
    return filepath;
  }

  /**
   * Print a summary to the console.
   */
  printSummary(results, pageVisits) {
    const { summary } = results;
    const duration = Math.round((Date.now() - this.startTime) / 1000);

    console.log('\n' + '='.repeat(60));
    console.log('  BENCHMARK RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Scenario:          ${this.scenario}`);
    console.log(`  Duration:          ${Math.floor(duration / 60)}m ${duration % 60}s`);
    console.log(`  Pages visited:     ${pageVisits.length}`);
    console.log('');
    console.log('  --- Ads ---');
    console.log(`  Total detected:    ${summary.totalAds}`);
    console.log(`    Image ads:       ${summary.imageAds}`);
    console.log(`    Text ads:        ${summary.textAds}`);
    console.log(`  Clicked:           ${summary.clickedAds}`);
    console.log(`  Failed clicks:     ${summary.failedClicks}`);
    console.log(`  Pending:           ${summary.pendingAds}`);
    console.log(`  Click success:     ${(summary.clickSuccessRate * 100).toFixed(1)}%`);
    console.log('');
    console.log('  --- Blocking ---');
    if (results.blockingStats) {
      console.log(`  Requests blocked:  ${results.blockingStats.requestStats.blockedCount}`);
      console.log(`  Requests allowed:  ${results.blockingStats.requestStats.allowedCount}`);
    }
    console.log('');
    console.log('  --- Top Domains by Ads ---');
    const domains = this.summarizeDomains(results.adsByDomain);
    domains.slice(0, 5).forEach(d => {
      console.log(`    ${d.domain}: ${d.count} ads`);
    });
    console.log('='.repeat(60) + '\n');
  }

  summarizeDomains(adsByDomain) {
    if (!adsByDomain) return [];
    return Object.entries(adsByDomain)
      .map(([domain, ads]) => ({ domain, count: ads.length }))
      .sort((a, b) => b.count - a.count);
  }

  computeAdGrowth(snapshots) {
    if (!snapshots || snapshots.length < 2) return [];
    return snapshots.map((s, i) => ({
      timestamp: s.timestamp,
      adCount: s.adCount,
      delta: i > 0 ? s.adCount - snapshots[i - 1].adCount : 0,
    }));
  }
}
