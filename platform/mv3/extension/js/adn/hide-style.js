/*******************************************************************************

    AdNauseam Lite - the style used to hide ads

    The one place the hiding style is defined. uBOL's content scripts keep
    their upstream `{display:none!important;}`; every hide rule reaches the
    page through the service worker (insertCSS/removeCSS in background.js,
    injectCustomFilters in filter-manager.js), which swaps in the style below.

    Invisible and 1px high, but in the flow with its full width, so lazy-loaded
    ads still render and can be collected. `display:none` gives the slot no box
    and the ad is never fetched.

*******************************************************************************/

export const adnHideStyle = 'display:block!important;height:1px!important;opacity:0!important;clip:rect(0 0 0 0)!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;';

const ubolHideRule = '{display:none!important;}';

// Same text for insertCSS and removeCSS, or the removal will not match
export const adnHideCSS = css => css.replaceAll(ubolHideRule, `{${adnHideStyle}}`);
