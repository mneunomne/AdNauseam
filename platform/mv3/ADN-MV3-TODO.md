# AdNauseam MV3 — Implementation TODO

Status of the MV3 port of AdNauseam, with concrete next tasks.
Backend (collect → store → visit) is largely working; the UI layer and
image persistence are the main gaps.

Legend: ✅ done · 🟡 partial · ❌ missing

---

## P0 — Image persistence (fixes the `placeholder.svg` bug)

**Problem:** the parser stores the *remote* image URL, not the image bytes.
On display, the popup/vault re-fetches the URL, which is blocked by DNR or
expired → `onerror` → `img/placeholder.svg`. MV2 stored ads as base64 data URIs
via `fetchImageAsBase64` (`src/js/adn/adn-utils.js:447`), which is unported.

**Constraint:** the MV3 service worker has no DOM/canvas, so conversion must run
in a context that has one: **parser.js (content script)** or the **offscreen doc**.

Tasks:
- [ ] Port `fetchImageAsBase64` (canvas → `toDataURL`) into `parser.js`.
- [ ] In `parser.js`, convert `data.imgSrc` to a data URI *before* `sendMessage('registerAd')`;
      stop preferring remote URLs over data URIs (`parser.js:175-181`).
- [ ] Cap stored image size (resize on canvas) to keep `chrome.storage.local` sane.
- [ ] Fallback: if conversion fails, keep the remote URL + current `onerror` path.

**Acceptance:** collected ads show real thumbnails in the popup and persist
across reloads with no network re-fetch.

---

## P1 — Vault UI (hard blocker)

**Problem:** `vault.html` loads `js/adn/vault.js` which **does not exist**.
MV2 vault is `src/js/adn/vault.js` (~2441 lines).

Tasks:
- [ ] Create `platform/mv3/extension/js/adn/vault.js` (ES module).
- [ ] Wire to existing background API: `adsForVault`, `getAdNauseamStats`,
      `deleteAd`, `deleteAdSet`, `purgeDeadAds`, `getCostPerClick`,
      `getHideDeadAds`/`setHideDeadAds`, `clearAds`, `exportAds`/`importAds`.
- [ ] Port: ad grid/bubble layout, zoom, hover detail, cost-per-click display,
      filter-by-page, dead-ad hiding/purge, export.
- [ ] Listen for broadcasts (`adDetected`, `adAttempt`, `adVisited`) for live updates.

**Acceptance:** opening the vault renders all collected ads with working
zoom/delete/export and live updates.

---

## P2 — Settings / options UI

**Problem:** settings only exist in background handlers; no UI to change them.
MV2 is `src/js/adn/options.js` (~423 lines).

Tasks:
- [ ] Add an AdNauseam pane to `dashboard.html` (or a dedicated options page).
- [ ] Expose: `clickingAds`, `clickProbability`, `costPerClick`, `blurCollectedAds`,
      `hideDeadAds`, `clickOnlyWhenIdleFor`, `disableWarnings`.
- [ ] Persist via `getAdnSettings`/`setAdnSettings` (already in `background.js`).

**Acceptance:** toggling settings persists and changes runtime behavior
(esp. `clickingAds` start/stop, `clickProbability`).

---

## P3 — Visit queue robustness

**Problem:** `visitor.js` uses `setInterval`, which dies when the SW is killed;
idle detection is a stub (`visitor.js:168`).

Tasks:
- [ ] Replace `setInterval` polling with `chrome.alarms` so the queue survives
      SW termination.
- [ ] Wire real idle detection via `chrome.idle` for `clickOnlyWhenIdleFor`.
- [ ] Verify offscreen-doc lifecycle (creation/teardown) under SW restarts.

**Acceptance:** clicking continues after the SW is evicted; idle setting honored.

---

## P4 — Notifications system

**Problem:** `getNotifications` is stubbed to `[]` (`background.js:402`).
MV2 is `src/js/adn/notifications.js` (~482 lines).

Tasks:
- [ ] Port notification rules (ad-blocker conflicts, DNT, warnings).
- [ ] Drive the menu warning/alert badges from real data.

---

## P5 — Remaining MV2 modules

- [ ] `dnt.js` (~173 lines) — EFF Do Not Track allowlist integration.
- [ ] `firstrun.js` — welcome/onboarding page.
- [ ] `strictblocklist.js` — strict-block list support.
- [ ] `tests.js` — port beyond the existing `test-adn-allow.js`.

---

## Verify (cross-cutting)

- [ ] Confirm `adn-allow` ruleset is actually built and enabled at runtime so
      ads load on the page (Layer A of collection). Check built `rulesets/main/adn-allow.json`.
- [ ] Confirm element-hiding uses `opacity:0` (not `display:none`) so ads stay
      clickable for click-obfuscation.
- [ ] End-to-end smoke test: load page with ads → collected → visited → shown
      in popup + vault.

---

## Recently fixed
- ✅ `recent-ads` class now toggled on `#ad-list-items` when showing recent ads
  (`menu.js` `renderAdList`).
