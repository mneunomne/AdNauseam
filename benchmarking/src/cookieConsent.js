/**
 * Automatically detects and accepts GDPR/cookie consent banners.
 * Runs after page load to dismiss popups that block interaction.
 */

// Common selectors for cookie consent "Accept" buttons
const ACCEPT_BUTTON_SELECTORS = [
  // Generic consent frameworks
  '[id*="accept" i][role="button"]',
  '[id*="accept" i]:is(button, a)',
  '[class*="accept" i][role="button"]',
  '[class*="accept" i]:is(button, a)',
  '[id*="consent" i][id*="accept" i]',
  '[data-testid*="accept" i]',
  '[data-action="accept"]',

  // CMP (Consent Management Platform) specific
  '.cmp-accept-all',
  '#onetrust-accept-btn-handler',
  '.onetrust-accept-btn-handler',
  '#accept-recommended-btn-handler',
  '.accept-recommended-btn-handler',
  '#didomi-notice-agree-button',
  '.didomi-notice-agree-button',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  '[data-cookiebanner="accept_button"]',
  '.cookie-notice-accept-button',
  '#cookie-accept',
  '#cookie_action_close_header',
  '.js-accept-cookies',
  '.js-cookie-accept',
  '#truste-consent-button',
  '#consent_prompt_submit',
  '.fc-cta-consent',
  '.fc-button.fc-cta-consent',
  '.sp_choice_type_11', // SourcePoint "Accept All"
  '[title="SP Consent Message"]',

  // IABTCF / Quantcast
  '.qc-cmp2-summary-buttons button:first-child',
  '[class*="qc-cmp"][class*="agree"]',
  '.evidon-banner-acceptbutton',

  // Common text-based patterns (broader selectors)
  'button[aria-label*="accept" i]',
  'button[aria-label*="agree" i]',
  'button[aria-label*="consent" i]',
  'button[aria-label*="Allow" i]',
  'a[aria-label*="accept" i]',
];

// Text patterns that indicate an "accept all" button
const ACCEPT_TEXT_PATTERNS = [
  /^accept\s*(all)?$/i,
  /^accept\s*cookies?$/i,
  /^agree$/i,
  /^i\s*agree$/i,
  /^allow\s*(all)?$/i,
  /^allow\s*cookies?$/i,
  /^got\s*it$/i,
  /^ok$/i,
  /^okay$/i,
  /^i\s*understand$/i,
  /^continue$/i,
  /^consent$/i,
  /^accept\s*(&|and)\s*close$/i,
  /^accept\s*(&|and)\s*continue$/i,
  /^alle\s*akzeptieren$/i,       // German
  /^akzeptieren$/i,              // German
  /^tout\s*accepter$/i,          // French
  /^accepter$/i,                 // French
  /^aceptar\s*(todo)?$/i,        // Spanish
  /^aceitar\s*(tudo)?$/i,        // Portuguese
  /^accetta\s*(tutti)?$/i,       // Italian
];

// Container selectors that typically hold cookie banners
const BANNER_CONTAINER_SELECTORS = [
  '#onetrust-banner-sdk',
  '#CybotCookiebotDialog',
  '#didomi-notice',
  '.fc-consent-root',
  '[id*="cookie-banner" i]',
  '[id*="cookiebanner" i]',
  '[id*="cookie-consent" i]',
  '[id*="cookie_consent" i]',
  '[id*="gdpr" i]',
  '[class*="cookie-banner" i]',
  '[class*="cookiebanner" i]',
  '[class*="cookie-consent" i]',
  '[class*="consent-banner" i]',
  '[class*="gdpr" i]',
  '[aria-label*="cookie" i]',
  '[aria-label*="consent" i]',
  '[role="dialog"][aria-label*="privacy" i]',
];

/**
 * Attempt to dismiss cookie/GDPR consent banners on the current page.
 * Returns true if a banner was found and dismissed.
 */
export async function dismissCookieConsent(page) {
  try {
    const dismissed = await page.evaluate((selectors, textPatterns, bannerSelectors) => {
      // Strategy 1: Try known accept button selectors
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            if (isVisible(el) && isConsentButton(el)) {
              el.click();
              return { method: 'selector', selector, text: el.textContent.trim().slice(0, 50) };
            }
          }
        } catch { /* selector may be invalid */ }
      }

      // Strategy 2: Find buttons/links by text content within consent banners
      for (const containerSel of bannerSelectors) {
        try {
          const container = document.querySelector(containerSel);
          if (!container || !isVisible(container)) continue;

          const buttons = container.querySelectorAll('button, a[role="button"], [role="button"], input[type="submit"]');
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (matchesAcceptText(text, textPatterns) && isVisible(btn)) {
              btn.click();
              return { method: 'text_in_banner', text: text.slice(0, 50) };
            }
          }
        } catch { /* continue */ }
      }

      // Strategy 3: Search all visible buttons on the page for accept text
      const allButtons = document.querySelectorAll('button, a[role="button"], [role="button"]');
      for (const btn of allButtons) {
        const text = btn.textContent.trim();
        if (text.length > 50) continue; // Skip buttons with too much text (not a simple consent button)
        if (matchesAcceptText(text, textPatterns) && isVisible(btn) && looksLikeConsentButton(btn)) {
          btn.click();
          return { method: 'text_global', text: text.slice(0, 50) };
        }
      }

      return null;

      function isVisible(el) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0';
      }

      function isConsentButton(el) {
        const text = el.textContent.trim().toLowerCase();
        // Must have some text and not be a "reject" or "manage" button
        return text.length > 0 && text.length < 60 &&
          !text.includes('reject') &&
          !text.includes('decline') &&
          !text.includes('manage') &&
          !text.includes('settings') &&
          !text.includes('preferences') &&
          !text.includes('customize');
      }

      function matchesAcceptText(text, patterns) {
        return patterns.some(p => new RegExp(p).test(text));
      }

      function looksLikeConsentButton(el) {
        // Check if the button is likely part of a consent dialog
        // (positioned fixed/sticky at bottom/top, or inside a modal overlay)
        let parent = el.parentElement;
        for (let i = 0; i < 10 && parent; i++) {
          const style = window.getComputedStyle(parent);
          const pos = style.position;
          if (pos === 'fixed' || pos === 'sticky') return true;
          if (style.zIndex && parseInt(style.zIndex) > 100) return true;
          if (parent.getAttribute('role') === 'dialog') return true;
          parent = parent.parentElement;
        }
        return false;
      }
    }, ACCEPT_BUTTON_SELECTORS, ACCEPT_TEXT_PATTERNS.map(r => r.source), BANNER_CONTAINER_SELECTORS);

    if (dismissed) {
      console.log(`[gdpr] Dismissed consent banner (${dismissed.method}): "${dismissed.text}"`);
      return true;
    }

    // Strategy 4: Check for consent in iframes (some CMPs use iframes)
    const frames = page.frames();
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      try {
        const frameUrl = frame.url();
        if (!frameUrl.includes('consent') && !frameUrl.includes('cookie') && !frameUrl.includes('cmp')) continue;

        const iframeDismissed = await frame.evaluate((selectors, textPatterns) => {
          const buttons = document.querySelectorAll('button, a[role="button"], [role="button"]');
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text.length > 50) continue;
            const matches = textPatterns.some(p => new RegExp(p).test(text));
            if (matches) {
              btn.click();
              return { text: text.slice(0, 50) };
            }
          }

          for (const selector of selectors) {
            try {
              const el = document.querySelector(selector);
              if (el) { el.click(); return { text: selector }; }
            } catch {}
          }
          return null;
        }, ACCEPT_BUTTON_SELECTORS, ACCEPT_TEXT_PATTERNS.map(r => r.source));

        if (iframeDismissed) {
          console.log(`[gdpr] Dismissed consent in iframe: "${iframeDismissed.text}"`);
          return true;
        }
      } catch { /* frame may have been detached */ }
    }

    return false;
  } catch (e) {
    // Page might have navigated during evaluation
    return false;
  }
}

/**
 * Set up automatic GDPR dismissal after every navigation.
 * Waits a brief moment for banners to render, then tries to dismiss.
 */
export function setupAutoDismiss(page) {
  page.on('load', async () => {
    // Wait for consent banners to render (they often load async)
    await new Promise(r => setTimeout(r, 1500));
    await dismissCookieConsent(page);
    // Some banners appear with a delay — try again after 3s
    await new Promise(r => setTimeout(r, 2000));
    await dismissCookieConsent(page);
  });
}
