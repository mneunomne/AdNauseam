/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* globals browser */

'use strict';

/******************************************************************************/

import htmlFilteringEngine from './html-filtering.js';
import httpheaderFilteringEngine from './httpheader-filtering.js';
import logger from './logger.js';
import scriptletFilteringEngine from './scriptlet-filtering.js';
import staticNetFilteringEngine from './static-net-filtering.js';
import textEncode from './text-encode.js';
import µb from './background.js';
// ADN
import adnauseam from './adn/core.js'
import {
    logRedirect,
    logNetEvent,
    logNetBlock
} from './adn/log.js'
// end ADN 
import {
    sessionFirewall,
    sessionSwitches,
    sessionURLFiltering,
} from './filtering-engines.js';

import {
    entityFromDomain,
    isNetworkURI,
} from './uri-utils.js';

/******************************************************************************/

const AcceptHeaders = {
    chrome: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    firefox: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};
const CommonUserAgent = 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/40.0.2214.85 Safari/537.36';

let exports = {};

/********************************* ADN ****************************************/

// Called before each outgoing request (ADN:)
const onBeforeSendHeaders = function (details) {

    const headers = details.requestHeaders, prefs = µb.userSettings, adn = adnauseam;

    // if clicking/hiding is enabled with DNT, then send the DNT header
    const respectDNT = ((prefs.clickingAds && prefs.disableClickingForDNT) ||
        (prefs.hidingAds && prefs.disableHidingForDNT));

    if (respectDNT) {

        const pageStore = µb.mustPageStoreFromTabId(details.tabId);

        // add it only if the browser is not sending it already
        if (pageStore.getNetFilteringSwitch() && !hasDNT(headers)) {

            if (details.type === 'main_frame') {// minimize logging
                logNetEvent('[HEADER]', 'Append', 'DNT:1', details.url);
            }

            addHeader(headers, 'DNT', '1');
        }
    }

    // Is this an XMLHttpRequest ?
    if (vAPI.isBehindTheSceneTabId(details.tabId)) {

        // If so, is it one of our Ad visits ?
        const ad = adn.lookupAd(details.url, details.requestId);

        // if so, handle the headers (cookies, ua, referer, dnt)
        ad && beforeAdVisit(details, headers, prefs, ad, respectDNT);

        //if (ad) console.log('ADN-VISIT: '+details.url, 'DNT? '+hasDNT(headers), ad);
    }

    // ADN: if this was an adn-allowed request, do we block cookies, etc.? TODO:
    return { requestHeaders: headers };
};

// ADN: remove outgoing cookies, reset user-agent, strip referer
const beforeAdVisit = function (details, headers, prefs, ad, respectDNT) {

    var referer = ad.pageUrl, refererIdx = -1, dbug = 0;
    let uirIdx = -1;

    ad.requestId = details.requestId; // needed?

    dbug && console.log('[HEADERS] (Outgoing' + (ad.targetUrl === details.url ? ')' : '-redirect)'), details.url);

    for (let i = headers.length - 1; i >= 0; i--) {

        dbug && console.log(i + ") " + headers[i].name, headers[i].value);
        const name = headers[i].name.toLowerCase();

        if ((name === 'http_x_requested_with') ||
            (name === 'x-devtools-emulate-network-conditions-client-id') ||
            (prefs.noOutgoingCookies && name === 'cookie') ||
            (prefs.noOutgoingUserAgent && name === 'user-agent')) {
            setHeader(headers[i], '');

            // Block outgoing cookies and user-agent here if specified
            if (prefs.noOutgoingCookies && name === 'cookie') {
                logNetEvent('[COOKIE]', 'Strip', headers[i].value, details.url);
            }

            // Replace user-agent with most common string, if specified
            if (prefs.noOutgoingUserAgent && name === 'user-agent') {
                headers[i].value = CommonUserAgent;
                logNetEvent('[UAGENT]', 'Default', headers[i].value, details.url);
            }
        }

        if (name === 'referer') {
            refererIdx = i;
        }

        if (vAPI.chrome && name === 'upgrade-insecure-requests') {
            uirIdx = i;
        }

        if (name === 'accept') { // Set browser-specific accept header
            setHeader(headers[i], vAPI.firefox ? AcceptHeaders.firefox : AcceptHeaders.chrome);
        }
    }

    // Add UIR header if chrome
    if (vAPI.chrome && uirIdx < 0) {
        addHeader(headers, 'Upgrade-Insecure-Requests', '1');
    }

    // add DNT header if needed and not included
    if (respectDNT && !hasDNT(headers)) {
        addHeader(headers, 'DNT', '1');
    }

    handleRefererForVisit(prefs, refererIdx, referer, details.url, headers);
};

const handleRefererForVisit = function (prefs, refIdx, referer, url, headers) {

    // console.log('handleRefererForVisit()', arguments);

    // Referer cases (4):
    // noOutgoingReferer=true  / no refIdx:     no-op
    // noOutgoingReferer=true  / have refIdx:   setHeader('')
    // noOutgoingReferer=false / no refIdx:     addHeader(referer)
    // noOutgoingReferer=false / have refIdx:   no-op
    if (refIdx > -1 && prefs.noOutgoingReferer) {

        // will never happen when using XMLHttpRequest
        logNetEvent('[REFERER]', 'Strip', referer, url);
        setHeader(headers[refIdx], '');

    } else if (!prefs.noOutgoingReferer && refIdx < 0) {

        logNetEvent('[REFERER]', 'Allow', referer, url);
        addHeader(headers, 'Referer', referer);
    }
};

function dumpHeaders(headers) {

    const s = '\n\n';
    for (let i = headers.length - 1; i >= 0; i--) {
        s += headers[i].name + ': ' + headers[i].value + '\n';
    }
    return s;
}

const setHeader = function (header, value) {

    if (header) header.value = value;
};

const addHeader = function (headers, name, value) {
    headers.push({
        name: name,
        value: value
    });
};

const hasDNT = function (headers) {

    for (let i = headers.length - 1; i >= 0; i--) {
        if (headers[i].name === 'DNT' && headers[i].value === '1') {
            return true;
        }
    }
    return false;
}

/******************************************************************************/

// Platform-specific behavior.

// https://github.com/uBlockOrigin/uBlock-issues/issues/42
// https://bugzilla.mozilla.org/show_bug.cgi?id=1376932
//   Add proper version number detection once issue is fixed in Firefox.
let dontCacheResponseHeaders =
    vAPI.webextFlavor.soup.has('firefox');

// The real actual webextFlavor value may not be set in stone, so listen
// for possible future changes.
window.addEventListener('webextFlavor', function () {
    dontCacheResponseHeaders =
        vAPI.webextFlavor.soup.has('firefox');
}, { once: true });

/******************************************************************************/

const patchLocalRedirectURL = url => url.charCodeAt(0) === 0x2F /* '/' */
    ? vAPI.getURL(url)
    : url;

/******************************************************************************/

// Intercept and filter web requests.

const onBeforeRequest = function (details) {
    const fctxt = µb.filteringContext.fromWebrequestDetails(details);

    // Special handling for root document.
    // https://github.com/chrisaljoudi/uBlock/issues/1001
    // This must be executed regardless of whether the request is
    // behind-the-scene
    if (fctxt.itype === fctxt.MAIN_FRAME) {
        return onBeforeRootFrameRequest(fctxt);
    }

    // ADN: return here (AFTER onPageLoad) if prefs say not to block
    if (µb.userSettings.blockingMalware === false) return;

    // Special treatment: behind-the-scene requests
    const tabId = details.tabId;
    if (tabId < 0) {
        return onBeforeBehindTheSceneRequest(fctxt);
    }

    // Lookup the page store associated with this tab id.
    let pageStore = µb.pageStoreFromTabId(tabId);
    if (pageStore === null) {
        const tabContext = µb.tabContextManager.mustLookup(tabId);
        if (tabContext.tabId < 0) {
            return onBeforeBehindTheSceneRequest(fctxt);
        }
        vAPI.tabs.onNavigation({ tabId, frameId: 0, url: tabContext.rawURL });
        pageStore = µb.pageStoreFromTabId(tabId);
    }

    const result = pageStore.filterRequest(fctxt);

    pageStore.journalAddRequest(fctxt, result);

    if (logger.enabled) {
        fctxt.setRealm('network').toLogger();
    }

    // Redirected

    if (fctxt.redirectURL !== undefined) {
        logRedirect(fctxt); // ADN:redirect
        return { redirectUrl: patchLocalRedirectURL(fctxt.redirectURL) };
    }

    // Not redirected

    // Blocked
    if (result === 1) {  // ADN 1=block,
        // ADN: already logs this from core.js if result == 1
        //logNetBlock(fctxt);
        return { cancel: true }; // block
    }

    // Not blocked
    if (
        fctxt.itype === fctxt.SUB_FRAME &&
        details.parentFrameId !== -1 &&
        details.aliasURL === undefined
    ) {
        pageStore.setFrameURL(details);
    }

    if (result === 2) {
        return { cancel: false };
    }
};

/******************************************************************************/

const onBeforeRootFrameRequest = function (fctxt) {
    const requestURL = fctxt.url;

    // Special handling for root document.
    // https://github.com/chrisaljoudi/uBlock/issues/1001
    //   This must be executed regardless of whether the request is
    //   behind-the-scene
    const requestHostname = fctxt.getHostname();
    let result = 0;
    let logData;

    // If the site is whitelisted, disregard strict blocking
    const trusted = µb.getNetFilteringSwitch(requestURL) === false;
    if (trusted) {
        result = 2;
        if (logger.enabled) {
            logData = { engine: 'u', result: 2, raw: 'whitelisted' };
        }
    }

    // Permanently unrestricted?
    if (
        result === 0 &&
        sessionSwitches.evaluateZ('no-strict-blocking', requestHostname)
    ) {
        result = 2;
        if (logger.enabled) {
            logData = {
                engine: 'u',
                result: 2,
                raw: `no-strict-blocking: ${sessionSwitches.z} true`
            };
        }
    }

    // Temporarily whitelisted?
    if (result === 0 && strictBlockBypasser.isBypassed(requestHostname)) {
        result = 2;
        if (logger.enabled) {
            logData = {
                engine: 'u',
                result: 2,
                raw: 'no-strict-blocking: true (temporary)'
            };
        }
    }

    // Static filtering
    if (result === 0) {
        ({ result, logData } = shouldStrictBlock(fctxt, logger.enabled));
    }

    // ADN: Tell the core we have a new page
    adnauseam.onPageLoad(fctxt.tabId, requestURL);

    // ADN: return here if prefs say not to block
    if (µb.userSettings.blockingMalware === false) return;

    // Log
    fctxt.type = 'main_frame';

    const pageStore = µb.bindTabToPageStore(fctxt.tabId, 'beforeRequest');
    if (pageStore !== null) {
        pageStore.journalAddRootFrame('uncommitted', requestURL);
        pageStore.journalAddRequest(fctxt, result);
    }

    if (logger.enabled) {
        fctxt.setFilter(logData);
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/760
    //   Redirect non-blocked request?
    if (
        result !== 1 &&
        trusted === false &&
        pageStore !== null &&
        staticNetFilteringEngine.hasQuery(fctxt)
    ) {
        // Q: fctxt is often undefined here, but we've already referenced its type and tabId ??
        logRedirect(fctxt, 'beforeRequest.non-blocked'); // ADN: redirect unblocked
        pageStore.redirectNonBlockedRequest(fctxt);
    }

    if (logger.enabled) {
        fctxt.setRealm('network').toLogger();
    }

    // Redirected

    if (fctxt.redirectURL !== undefined) {
        logRedirect(fctxt, 'beforeRequest'); // ADN: redirect blocked
        return { redirectUrl: patchLocalRedirectURL(fctxt.redirectURL) };
    }

    // Not blocked

    if (result !== 1) { return; }

    // No log data means no strict blocking (because we need to report why
    // the blocking occurs.
    if (logData === undefined) { return; }

    // Blocked

    const query = encodeURIComponent(JSON.stringify({
        url: requestURL,
        hn: requestHostname,
        dn: fctxt.getDomain() || requestHostname,
        fs: logData.raw
    }));

    vAPI.tabs.replace(
        fctxt.tabId,
        vAPI.getURL('document-blocked.html?details=') + query
    );

};

/******************************************************************************/

// Strict blocking through static filtering
//
// https://github.com/chrisaljoudi/uBlock/issues/1128
//   Do not block if the match begins after the hostname,
//   except when the filter is specifically of type `other`.
// https://github.com/gorhill/uBlock/issues/490
//   Removing this for the time being, will need a new, dedicated type.
// https://github.com/uBlockOrigin/uBlock-issues/issues/1501
//   Support explicit exception filters.
//
// Let result of match for specific `document` type be `rs`
// Let result of match for no specific type be `rg` *after* going through
//   confirmation necessary for implicit matches
// Let `important` be `i`
// Let final result be logical combination of `rs` and `rg` as follow:
//
//                  |                rs                 |
//                  +--------+--------+--------+--------|
//                  |   0    |   1    |   1i   |   2    |
// --------+--------+--------+--------+--------+--------|
//         |   0    |   rg   |   rs   |   rs   |   rs   |
//    rg   |   1    |   rg   |   rs   |   rs   |   rs   |
//         |   1i   |   rg   |   rg   |   rs   |   rg   |
//         |   2    |   rg   |   rg   |   rs   |   rs   |
// --------+--------+--------+--------+--------+--------+

const shouldStrictBlock = function (fctxt, loggerEnabled) {
    const snfe = staticNetFilteringEngine;

    // Explicit filtering: `document` option
    const rs = snfe.matchRequest(fctxt, 0b0011);
    const is = rs === 1 && snfe.isBlockImportant();
    let lds;
    if (rs !== 0 || loggerEnabled) {
        lds = snfe.toLogData();
    }

    //                  |                rs                 |
    //                  +--------+--------+--------+--------|
    //                  |   0    |   1    |   1i   |   2    |
    // --------+--------+--------+--------+--------+--------|
    //         |   0    |   rg   |   rs   |   x    |   rs   |
    //    rg   |   1    |   rg   |   rs   |   x    |   rs   |
    //         |   1i   |   rg   |   rg   |   x    |   rg   |
    //         |   2    |   rg   |   rg   |   x    |   rs   |
    // --------+--------+--------+--------+--------+--------+
    if (rs === 1 && is) {
        return { result: rs, logData: lds };
    }

    // Implicit filtering: no `document` option
    fctxt.type = 'no_type';
    let rg = snfe.matchRequest(fctxt, 0b0011);
    fctxt.type = 'main_frame';
    const ig = rg === 1 && snfe.isBlockImportant();
    let ldg;
    if (rg !== 0 || loggerEnabled) {
        ldg = snfe.toLogData();
        if (rg === 1 && validateStrictBlock(fctxt, ldg) === false) {
            rg = 0; ldg = undefined;
        }
    }

    //                  |                rs                 |
    //                  +--------+--------+--------+--------|
    //                  |   0    |   1    |   1i   |   2    |
    // --------+--------+--------+--------+--------+--------|
    //         |   0    |   x    |   rs   |   -    |   rs   |
    //    rg   |   1    |   x    |   rs   |   -    |   rs   |
    //         |   1i   |   x    |   x    |   -    |   x    |
    //         |   2    |   x    |   x    |   -    |   rs   |
    // --------+--------+--------+--------+--------+--------+
    if (rs === 0 || rg === 1 && ig || rg === 2 && rs !== 2) {
        return { result: rg, logData: ldg };
    }

    //                  |                rs                 |
    //                  +--------+--------+--------+--------|
    //                  |   0    |   1    |   1i   |   2    |
    // --------+--------+--------+--------+--------+--------|
    //         |   0    |   -    |   x    |   -    |   x    |
    //    rg   |   1    |   -    |   x    |   -    |   x    |
    //         |   1i   |   -    |   -    |   -    |   -    |
    //         |   2    |   -    |   -    |   -    |   x    |
    // --------+--------+--------+--------+--------+--------+
    return { result: rs, logData: lds };
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3208
//   Mind case insensitivity.
// https://github.com/uBlockOrigin/uBlock-issues/issues/1147
//   Do not strict-block if the filter pattern does not contain at least one
//   token character.

const validateStrictBlock = function (fctxt, logData) {
    if (typeof logData.regex !== 'string') { return false; }
    if (typeof logData.raw === 'string' && /\w/.test(logData.raw) === false) {
        return false;
    }
    const url = fctxt.url;
    const re = new RegExp(logData.regex, 'i');
    const match = re.exec(url.toLowerCase());
    if (match === null) { return false; }

    // https://github.com/chrisaljoudi/uBlock/issues/1128
    // https://github.com/chrisaljoudi/uBlock/issues/1212
    //   Verify that the end of the match is anchored to the end of the
    //   hostname.
    // https://github.com/uBlockOrigin/uAssets/issues/7619#issuecomment-653010310
    //   Also match FQDN.
    const hostname = fctxt.getHostname();
    const hnpos = url.indexOf(hostname);
    const hnlen = hostname.length;
    const end = match.index + match[0].length - hnpos - hnlen;
    return end === 0 || end === 1 ||
        end === 2 && url.charCodeAt(hnpos + hnlen) === 0x2E /* '.' */;
};

/******************************************************************************/

// Intercept and filter behind-the-scene requests.

const onBeforeBehindTheSceneRequest = function (fctxt) {
    if (µb.userSettings.blockingMalware === false) return; // ADN

    const pageStore = µb.pageStoreFromTabId(fctxt.tabId);
    if (pageStore === null) { return; }

    // https://github.com/gorhill/uBlock/issues/3150
    //   Ability to globally block CSP reports MUST also apply to
    //   behind-the-scene network requests.

    let result = 0;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/339
    //   Need to also test against `-scheme` since tabOrigin is normalized.
    //   Not especially elegant but for now this accomplishes the purpose of
    //   not dealing with network requests fired from a synthetic scope,
    //   that is unless advanced user mode is enabled.

    if (
        fctxt.tabOrigin.endsWith('-scheme') === false &&
        isNetworkURI(fctxt.tabOrigin) ||
        µb.userSettings.advancedUserEnabled ||
        fctxt.itype === fctxt.CSP_REPORT
    ) {
        result = pageStore.filterRequest(fctxt);

        // The "any-tab" scope is not whitelist-able, and in such case we must
        // use the origin URL as the scope. Most such requests aren't going to
        // be blocked, so we test for whitelisting and modify the result only
        // when the request is being blocked.
        //
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1478
        //   Also remove potential redirection when request is to be
        //   whitelisted.
        if (
            result === 1 &&
            µb.getNetFilteringSwitch(fctxt.tabOrigin) === false
        ) {
            result = 2;
            fctxt.redirectURL = undefined;
            fctxt.filter = { engine: 'u', result: 2, raw: 'whitelisted' };
        }
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1204
    onBeforeBehindTheSceneRequest.journalAddRequest(fctxt, result);

    if (logger.enabled) {
        fctxt.setRealm('network').toLogger();
    }

    // Redirected

    if (fctxt.redirectURL !== undefined) {
        logRedirect(fctxt, `[BehindTheScene: ${fctxt.type}]`); // ADN: redirect xhr
        return { redirectUrl: patchLocalRedirectURL(fctxt.redirectURL) };
    }

    // Blocked?

    if (result === 1) {
        logNetBlock('BehindTheScene', fctxt.url, `(${fctxt.type})`); // ADN: Blocked xhr
        return { cancel: true };
    }

};

// https://github.com/uBlockOrigin/uBlock-issues/issues/1204
//   Report the tabless network requests to all page stores matching the
//   document origin. This is an approximation, there is unfortunately no
//   way to know for sure which exact page triggered a tabless network
//   request.

{
    const pageStores = new Set();
    let hostname = '';
    let pageStoresToken = 0;

    const reset = function () {
        hostname = '';
        pageStores.clear();
        pageStoresToken = 0;
    };

    const gc = ( ) => {
        if ( pageStoresToken !== µb.pageStoresToken ) { return reset(); }
        gcTimer.on(30011);
    };

    const gcTimer = vAPI.defer.create(gc);

    onBeforeBehindTheSceneRequest.journalAddRequest = (fctxt, result) => {
        const docHostname = fctxt.getDocHostname();
        if (
            docHostname !== hostname ||
            pageStoresToken !== µb.pageStoresToken
        ) {
            hostname = docHostname;
            pageStores.clear();
            for ( const pageStore of µb.pageStores.values() ) {
                if ( pageStore.tabHostname !== docHostname ) { continue; }
                pageStores.add(pageStore);
            }
            pageStoresToken = µb.pageStoresToken;
            gcTimer.offon(30011);
        }
        for (const pageStore of pageStores) {
            pageStore.journalAddRequest(fctxt, result);
        }
    };
}

/******************************************************************************/
const handleIncomingCookiesForAdVisits = function (details) {
    let ad, modified; //ADN
    const tabId = details.tabId;

    if (vAPI.isBehindTheSceneTabId(tabId)) {

        // ADN: handle incoming cookies for our visits
        if (µb.userSettings.noIncomingCookies) {

            //console.log('pre.onHeadersReceived: ', details.url, JSON.stringify(details.responseHeaders));
            ad = adnauseam.lookupAd(details.url, details.requestId);
            if (ad) {
                // this is an ADN request
                modified = adnauseam.blockIncomingCookies
                    (details.responseHeaders, details.url, ad.targetUrl);
                //if (modified) console.log('post.onHeadersReceived: ', details.url, JSON.stringify(details.responseHeaders));

            }
        }
        // don't return an empty headers array
        return modified && modified.length ? modified : null;
    }
}

/*
 * 1. ADN: block cookies for ad-visits
 * 2. UBLOCK: handle type-based filtering
 * 3. ADN: block cookies adn-allowed requests
 *    see https://github.com/dhowe/AdNauseam/wiki/Developer-FAQ#how-does-adnauseam-handle-incoming-and-outgoing-cookies
 */
const adnOnHeadersRecieved = function (details) {

    // 1: check for an ad visit (if so, block incoming cookies and return)
    const changedHeadersForAdVisit = handleIncomingCookiesForAdVisits(details);
    if (changedHeadersForAdVisit) return { responseHeaders: details.responseHeaders } // DH: fix for #1013 
    //if (typeof modifiedHeadersForAdVisits != "boolean") return { responseHeaders: modifiedHeadersForAdVisits }

    // 2: ublock filtering for the following request types:
    let headers;
    const ublock_filtering_types = ['main_frame', 'sub_frame', 'image', 'media', 'xmlhttprequest']; // where does this comes from?
    if (ublock_filtering_types.indexOf(details.type) > -1) {
        headers = onHeadersReceived(details); // return headers (if modified) or undefined
    }
    // has ublock modified the headers?
    let changedByUBlock = typeof headers !== 'undefined';
    headers = headers || details.responseHeaders

    // if ublock says 'cancel', no need to check adn rules
    if (headers.cancel === true) {
        logNetEvent('[CANCEL]', 'uBlock', 'type: '+details.type, JSON.stringify(headers));
        return { responseHeaders: headers };
    }

    // 3: Check for AdNauseam-allowed rule (if so, block incoming cookies)
    const fctxt = µb.filteringContext.fromWebrequestDetails(details);
    const pageStore = µb.pageStoreFromTabId(fctxt.tabId);
    // this function not only checks if it an Adn-allow but also blocks the cookies from the request if thats the case
    // to block the cookie, it changes the `headers` object removing the cookie from it
    const changedHeadersForAdnAllowed = (typeof pageStore !== 'undefined' && pageStore !== null) && adnauseam.checkAllowedException(headers, details.url, pageStore.rawURL); 
    // if the header was changed either by uBlock or Adnauseam, return it as responseHeaders
    if (changedByUBlock || changedHeadersForAdnAllowed) return { responseHeaders: headers } // DH: fix for #1013
}

const onHeadersReceived = function (details) {
    // https://github.com/uBlockOrigin/uBlock-issues/issues/610
    // Process behind-the-scene requests in a special way.
    if (
        details.tabId < 0 &&
        normalizeBehindTheSceneResponseHeaders(details) === false
    ) {
        return;
    }

    const fctxt = µb.filteringContext.fromWebrequestDetails(details);
    const isRootDoc = fctxt.itype === fctxt.MAIN_FRAME;

    let pageStore = µb.pageStoreFromTabId(fctxt.tabId);

    if (pageStore === null) {
        if (isRootDoc === false) { return; }
        pageStore = µb.bindTabToPageStore(fctxt.tabId, 'beforeRequest');
    }
    if (pageStore.getNetFilteringSwitch(fctxt) === false) { return; }

    if (fctxt.itype === fctxt.IMAGE || fctxt.itype === fctxt.MEDIA) {
        const result = foilLargeMediaElement(details, fctxt, pageStore);
        if (result !== undefined) { return result; }
    }

    // Keep in mind response headers will be modified in-place if needed, so
    // `details.responseHeaders` will always point to the modified response
    // headers.
    const { responseHeaders } = details;
    if (Array.isArray(responseHeaders) === false) { return; }

    if (isRootDoc === false && µb.hiddenSettings.filterOnHeaders === true) {
        const result = pageStore.filterOnHeaders(fctxt, responseHeaders);
        if (result !== 0) {
            if (logger.enabled) {
                fctxt.setRealm('network').toLogger();
            }
            if (result === 1) {
                pageStore.journalAddRequest(fctxt, 1);
                logNetBlock('Headers', fctxt.url); // ADN: block
                return { cancel: true };
            }
        }
    }

    if (isRootDoc === false && fctxt.itype !== fctxt.SUB_FRAME) { return; }

    // https://github.com/gorhill/uBlock/issues/2813
    //   Disable the blocking of large media elements if the document is itself
    //   a media element: the resource was not prevented from loading so no
    //   point to further block large media elements for the current document.
    if (isRootDoc) {
        const contentType = headerValueFromName('content-type', responseHeaders);
        if (reMediaContentTypes.test(contentType)) {
            pageStore.allowLargeMediaElementsUntil = 0;
            // Fall-through: this could be an SVG document, which supports
            // script tags.
        }
    }

    // At this point we have a HTML document.

    const filteredHTML =
        µb.canFilterResponseData && filterDocument(fctxt, details) === true;

    let modifiedHeaders = false;
    if (httpheaderFilteringEngine.apply(fctxt, responseHeaders) === true) {
        modifiedHeaders = true;
    }
    if (injectCSP(fctxt, pageStore, responseHeaders) === true) {
        modifiedHeaders = true;
    }

    if ( injectPP(fctxt, pageStore, responseHeaders) === true ) {
        modifiedHeaders = true;
    }

    // https://bugzilla.mozilla.org/show_bug.cgi?id=1376932
    //   Prevent document from being cached by the browser if we modified it,
    //   either through HTML filtering and/or modified response headers.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/229
    //   Use `no-cache` instead of `no-cache, no-store, must-revalidate`, this
    //   allows Firefox's offline mode to work as expected.
    if ((filteredHTML || modifiedHeaders) && dontCacheResponseHeaders) {
        const cacheControl = µb.hiddenSettings.cacheControlForFirefox1376932;
        if (cacheControl !== 'unset') {
            let i = headerIndexFromName('cache-control', responseHeaders);
            if (i !== -1) {
                responseHeaders[i].value = cacheControl;
            } else {
                responseHeaders.push({ name: 'Cache-Control', value: cacheControl });
            }
            modifiedHeaders = true;
        }
    }

    if (modifiedHeaders) {
        return { responseHeaders };
    }
};

const reMediaContentTypes = /^(?:audio|image|video)\//;

/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/610

const normalizeBehindTheSceneResponseHeaders = function (details) {
    if (details.type !== 'xmlhttprequest') { return false; }
    const headers = details.responseHeaders;
    if (Array.isArray(headers) === false) { return false; }
    const contentType = headerValueFromName('content-type', headers);
    if (contentType === '') { return false; }
    if (reMediaContentTypes.test(contentType) === false) { return false; }
    if (contentType.startsWith('image')) {
        details.type = 'image';
    } else {
        details.type = 'media';
    }
    return true;
};

/*******************************************************************************

    The response body filterer is responsible for:

    - HTML filtering

    In the spirit of efficiency, the response body filterer works this way:

    If:
        - HTML filtering: no.
    Then:
        No response body filtering is initiated.

    If:
        - HTML filtering: yes.
    Then:
        Assemble all response body data into a single buffer. Once all the
        response data has been received, create a document from it. Then:
        - Remove all DOM elements matching HTML filters.
        Then serialize the resulting modified document as the new response
        body.

**/

const filterDocument = (() => {
    const filterers = new Map();
    let domParser, xmlSerializer,
        utf8TextDecoder, textDecoder, textEncoder;

    const textDecode = function (encoding, buffer) {
        if (
            textDecoder !== undefined &&
            textDecoder.encoding !== encoding
        ) {
            textDecoder = undefined;
        }
        if (textDecoder === undefined) {
            textDecoder = new TextDecoder(encoding);
        }
        return textDecoder.decode(buffer);
    };

    const reContentTypeDocument = /^(?:text\/html|application\/xhtml\+xml)/i;
    const reContentTypeCharset = /charset=['"]?([^'" ]+)/i;

    const mimeFromContentType = function (contentType) {
        const match = reContentTypeDocument.exec(contentType);
        if (match !== null) {
            return match[0].toLowerCase();
        }
    };

    const charsetFromContentType = function (contentType) {
        const match = reContentTypeCharset.exec(contentType);
        if (match !== null) {
            return match[1].toLowerCase();
        }
    };

    const charsetFromDoc = function (doc) {
        let meta = doc.querySelector('meta[charset]');
        if (meta !== null) {
            return meta.getAttribute('charset').toLowerCase();
        }
        meta = doc.querySelector(
            'meta[http-equiv="content-type" i][content]'
        );
        if (meta !== null) {
            return charsetFromContentType(meta.getAttribute('content'));
        }
    };

    const streamClose = function (filterer, buffer) {
        if (buffer !== undefined) {
            filterer.stream.write(buffer);
        } else if (filterer.buffer !== undefined) {
            filterer.stream.write(filterer.buffer);
        }
        filterer.stream.close();
    };

    const onStreamData = function (ev) {
        const filterer = filterers.get(this);
        if (filterer === undefined) {
            this.write(ev.data);
            this.disconnect();
            return;
        }
        if (
            this.status !== 'transferringdata' &&
            this.status !== 'finishedtransferringdata'
        ) {
            filterers.delete(this);
            this.disconnect();
            return;
        }
        // TODO:
        // - Possibly improve buffer growth, if benchmarking shows it's worth
        //   it.
        // - Also evaluate whether keeping a list of buffers and then decoding
        //   them in sequence using TextDecoder's "stream" option is more
        //   efficient. Can the data buffers be safely kept around for later
        //   use?
        // - Informal, quick benchmarks seem to show most of the overhead is
        //   from calling TextDecoder.decode() and TextEncoder.encode(), and if
        //   confirmed, there is nothing which can be done uBO-side to reduce
        //   overhead.
        if (filterer.buffer === null) {
            filterer.buffer = new Uint8Array(ev.data);
            return;
        }
        const buffer = new Uint8Array(
            filterer.buffer.byteLength +
            ev.data.byteLength
        );
        buffer.set(filterer.buffer);
        buffer.set(new Uint8Array(ev.data), filterer.buffer.byteLength);
        filterer.buffer = buffer;
    };

    const onStreamStop = function () {
        const filterer = filterers.get(this);
        filterers.delete(this);
        if (filterer === undefined || filterer.buffer === null) {
            this.close();
            return;
        }
        if (this.status !== 'finishedtransferringdata') { return; }

        if (domParser === undefined) {
            domParser = new DOMParser();
            xmlSerializer = new XMLSerializer();
        }
        if (textEncoder === undefined) {
            textEncoder = new TextEncoder();
        }

        let doc;

        // If stream encoding is still unknnown, try to extract from document.
        let charsetFound = filterer.charset,
            charsetUsed = charsetFound;
        if (charsetFound === undefined) {
            if (utf8TextDecoder === undefined) {
                utf8TextDecoder = new TextDecoder();
            }
            doc = domParser.parseFromString(
                utf8TextDecoder.decode(filterer.buffer.slice(0, 1024)),
                filterer.mime
            );
            charsetFound = charsetFromDoc(doc);
            charsetUsed = textEncode.normalizeCharset(charsetFound);
            if (charsetUsed === undefined) {
                return streamClose(filterer);
            }
        }

        doc = domParser.parseFromString(
            textDecode(charsetUsed, filterer.buffer),
            filterer.mime
        );

        // https://github.com/gorhill/uBlock/issues/3507
        //   In case of no explicit charset found, try to find one again, but
        //   this time with the whole document parsed.
        if (charsetFound === undefined) {
            charsetFound = textEncode.normalizeCharset(charsetFromDoc(doc));
            if (charsetFound !== charsetUsed) {
                if (charsetFound === undefined) {
                    return streamClose(filterer);
                }
                charsetUsed = charsetFound;
                doc = domParser.parseFromString(
                    textDecode(charsetFound, filterer.buffer),
                    filterer.mime
                );
            }
        }

        let modified = false;
        if (filterer.selectors !== undefined) {
            if (htmlFilteringEngine.apply(doc, filterer)) {
                modified = true;
            }
        }

        if (modified === false) {
            return streamClose(filterer);
        }

        // https://stackoverflow.com/questions/6088972/get-doctype-of-an-html-as-string-with-javascript/10162353#10162353
        const doctypeStr = doc.doctype instanceof Object ?
            xmlSerializer.serializeToString(doc.doctype) + '\n' :
            '';

        // https://github.com/gorhill/uBlock/issues/3391
        let encodedStream = textEncoder.encode(
            doctypeStr +
            doc.documentElement.outerHTML
        );
        if (charsetUsed !== 'utf-8') {
            encodedStream = textEncode.encode(
                charsetUsed,
                encodedStream
            );
        }

        streamClose(filterer, encodedStream);
    };

    const onStreamError = function () {
        filterers.delete(this);
    };

    return function (fctxt, extras) {
        // https://github.com/gorhill/uBlock/issues/3478
        const statusCode = extras.statusCode || 0;
        if (statusCode !== 0 && (statusCode < 200 || statusCode >= 300)) {
            return;
        }

        const hostname = fctxt.getHostname();
        if (hostname === '') { return; }

        const domain = fctxt.getDomain();

        const request = {
            stream: undefined,
            tabId: fctxt.tabId,
            url: fctxt.url,
            hostname: hostname,
            domain: domain,
            entity: entityFromDomain(domain),
            selectors: undefined,
            buffer: null,
            mime: 'text/html',
            charset: undefined
        };

        request.selectors = htmlFilteringEngine.retrieve(request);
        if (request.selectors === undefined) { return; }

        const headers = extras.responseHeaders;
        const contentType = headerValueFromName('content-type', headers);
        if (contentType !== '') {
            request.mime = mimeFromContentType(contentType);
            if (request.mime === undefined) { return; }
            let charset = charsetFromContentType(contentType);
            if (charset !== undefined) {
                charset = textEncode.normalizeCharset(charset);
                if (charset === undefined) { return; }
                request.charset = charset;
            }
        }
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1426789
        const disposition = headerValueFromName('content-disposition', headers);
        if ( disposition !== '' && disposition.startsWith('inline') === false ) { return; }

        const stream = request.stream =
            browser.webRequest.filterResponseData(extras.requestId);
        stream.ondata = onStreamData;
        stream.onstop = onStreamStop;
        stream.onerror = onStreamError;
        filterers.set(stream, request);

        return true;
    };
})();

/******************************************************************************/

const injectCSP = function (fctxt, pageStore, responseHeaders) {
    const cspSubsets = [];
    const requestType = fctxt.type;

    // Start collecting policies >>>>>>>>

    // ======== built-in policies

    const builtinDirectives = [];

    if (pageStore.filterScripting(fctxt, true) === 1) {
        builtinDirectives.push(µb.cspNoScripting);
        if (logger.enabled) {
            fctxt.setRealm('network').setType('scripting').toLogger();
        }
    }
    // https://github.com/uBlockOrigin/uBlock-issues/issues/422
    //   We need to derive a special context for filtering `inline-script`,
    //   as the embedding document for this "resource" will always be the
    //   frame itself, not that of the parent of the frame.
    else {
        const fctxt2 = fctxt.duplicate();
        fctxt2.type = 'inline-script';
        fctxt2.setDocOriginFromURL(fctxt.url);
        const result = pageStore.filterRequest(fctxt2);
        if (result === 1) {
            builtinDirectives.push(µb.cspNoInlineScript);
        }
        if (result === 2 && logger.enabled) {
            fctxt2.setRealm('network').toLogger();
        }
    }

    // https://github.com/gorhill/uBlock/issues/1539
    // - Use a CSP to also forbid inline fonts if remote fonts are blocked.
    fctxt.type = 'inline-font';
    if (pageStore.filterRequest(fctxt) === 1) {
        builtinDirectives.push(µb.cspNoInlineFont);
        if (logger.enabled) {
            fctxt.setRealm('network').toLogger();
        }
    }

    if (builtinDirectives.length !== 0) {
        cspSubsets[0] = builtinDirectives.join(', ');
    }

    // ======== filter-based policies

    // Static filtering.

    fctxt.type = requestType;
    const staticDirectives =
        staticNetFilteringEngine.matchAndFetchModifiers(fctxt, 'csp');
    if ( staticDirectives !== undefined ) {
        for ( const directive of staticDirectives ) {
            if ( directive.result !== 1 ) { continue; }
            cspSubsets.push(directive.value);
        }
    }

    // URL filtering `allow` rules override static filtering.
    if (
        cspSubsets.length !== 0 &&
        sessionURLFiltering.evaluateZ(
            fctxt.getTabHostname(),
            fctxt.url,
            'csp'
        ) === 2
    ) {
        if (logger.enabled) {
            fctxt.setRealm('network')
                .setType('csp')
                .setFilter(sessionURLFiltering.toLogData())
                .toLogger();
        }
        return;
    }

    // Dynamic filtering `allow` rules override static filtering.
    if (
        cspSubsets.length !== 0 &&
        µb.userSettings.advancedUserEnabled &&
        sessionFirewall.evaluateCellZY(
            fctxt.getTabHostname(),
            fctxt.getTabHostname(),
            '*'
        ) === 2
    ) {
        if (logger.enabled) {
            fctxt.setRealm('network')
                .setType('csp')
                .setFilter(sessionFirewall.toLogData())
                .toLogger();
        }
        return;
    }

    // <<<<<<<< All policies have been collected

    // Static CSP policies will be applied.

    if (logger.enabled && staticDirectives !== undefined) {
        fctxt.setRealm('network')
            .pushFilters(staticDirectives.map(a => a.logData()))
            .toLogger();
    }

    if (cspSubsets.length === 0) { return; }

    µb.updateToolbarIcon(fctxt.tabId, 0b0010);

    // Use comma to merge CSP directives.
    // Ref.: https://www.w3.org/TR/CSP2/#implementation-considerations
    //
    // https://github.com/gorhill/uMatrix/issues/967
    //   Inject a new CSP header rather than modify an existing one, except
    //   if the current environment does not support merging headers:
    //   Firefox 58/webext and less can't merge CSP headers, so we will merge
    //   them here.

    responseHeaders.push({
        name: 'Content-Security-Policy',
        value: cspSubsets.join(', ')
    });

    return true;
};

/******************************************************************************/

const injectPP = function(fctxt, pageStore, responseHeaders) {
    const permissions = [];
    const directives = staticNetFilteringEngine.matchAndFetchModifiers(fctxt, 'permissions');
    if ( directives !== undefined ) {
        for ( const directive of directives ) {
            if ( directive.result !== 1 ) { continue; }
            permissions.push(directive.value.replace('|', ', '));
        }
    }

    if ( logger.enabled && directives !== undefined ) {
        fctxt.setRealm('network')
             .pushFilters(directives.map(a => a.logData()))
             .toLogger();
    }

    if ( permissions.length === 0 ) { return; }

    µb.updateToolbarIcon(fctxt.tabId, 0x02);

    responseHeaders.push({
        name: 'permissions-policy',
        value: permissions.join(', ')
    });

    return true;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/1163
//   "Block elements by size".
// https://github.com/gorhill/uBlock/issues/1390#issuecomment-187310719
//   Do not foil when the media element is fetched from the browser
//   cache. This works only when the webext API supports the `fromCache`
//   property (Firefox).

const foilLargeMediaElement = function (details, fctxt, pageStore) {
    if (details.fromCache === true) { return; }

    let size = 0;
    if (µb.userSettings.largeMediaSize !== 0) {
        const headers = details.responseHeaders;
        const i = headerIndexFromName('content-length', headers);
        if (i === -1) { return; }
        size = parseInt(headers[i].value, 10) || 0;
    }

    const result = pageStore.filterLargeMediaElement(fctxt, size);
    if (result === 0) { return; }

    if (logger.enabled) {
        fctxt.setRealm('network').toLogger();
    }

    return { cancel: true };
};

/******************************************************************************/

// Caller must ensure headerName is normalized to lower case.

const headerIndexFromName = function (headerName, headers) {
    let i = headers.length;
    while (i--) {
        if (headers[i].name.toLowerCase() === headerName) {
            return i;
        }
    }
    return -1;
};

const headerValueFromName = function (headerName, headers) {
    const i = headerIndexFromName(headerName, headers);
    return i !== -1 ? headers[i].value : '';
};


const strictBlockBypasser = {
    hostnameToDeadlineMap: new Map(),
    cleanupTimer: vAPI.defer.create(( ) => {
        strictBlockBypasser.cleanup();
    }),

    cleanup: function () {
        for (const [hostname, deadline] of this.hostnameToDeadlineMap) {
            if (deadline <= Date.now()) {
                this.hostnameToDeadlineMap.delete(hostname);
            }
        }
    },

    revokeTime: function() {
        return Date.now() + µb.hiddenSettings.strictBlockingBypassDuration * 1000;
    },

    bypass: function(hostname) {
        if ( typeof hostname !== 'string' || hostname === '' ) { return; }
        this.hostnameToDeadlineMap.set(hostname, this.revokeTime());
    },

    isBypassed: function(hostname) {
        if ( this.hostnameToDeadlineMap.size === 0 ) { return false; }
        this.cleanupTimer.on({ sec: µb.hiddenSettings.strictBlockingBypassDuration + 10 });
        for (;;) {
            const deadline = this.hostnameToDeadlineMap.get(hostname);
            if ( deadline !== undefined ) {
                if ( deadline > Date.now() ) {
                    this.hostnameToDeadlineMap.set(hostname, this.revokeTime());
                    return true;
                }
                this.hostnameToDeadlineMap.delete(hostname);
            }
            const pos = hostname.indexOf('.');
            if (pos === -1) { break; }
            hostname = hostname.slice(pos + 1);
        }
        return false;
    }
};

/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/2350
//   Added scriptlet injection attempt at onResponseStarted time as per
//   https://github.com/AdguardTeam/AdguardBrowserExtension/issues/1029 and
//   https://github.com/AdguardTeam/AdguardBrowserExtension/blob/9ab85be5/Extension/src/background/webrequest.js#L620

const webRequest = {
    onBeforeRequest,
    start: (( ) => {
        vAPI.net = new vAPI.Net();
        if ( vAPI.Net.canSuspend() ) {
            vAPI.net.suspend();
        }

        return ( ) => {
            vAPI.net.setSuspendableListener(onBeforeRequest);
            vAPI.net.addListener(
                'onHeadersReceived',
                adnOnHeadersRecieved,
                {
                    urls: ['http://*/*', 'https://*/*'],
                },
                // ADN: https://developer.chrome.com/extensions/webRequest
                navigator.userAgent.includes('Firefox/') ?
                    ['blocking', 'responseHeaders'] :
                    ['blocking', 'responseHeaders', 'extraHeaders']
            );
            // Start of ADN 
            // Change heading adding DNT: 1 in all outgoing headers
            vAPI.net.addListener(
                'onBeforeSendHeaders',
                 onBeforeSendHeaders,
                 {
                     'urls': [ '<all_urls>' ],
                     'types': undefined
                 },
                 navigator.userAgent.includes('Firefox/') ? [ 'blocking', 'requestHeaders'] : ['blocking', 'requestHeaders', 'extraHeaders'] //ADN
             );
            // end of ADN
            vAPI.net.addListener(
                'onResponseStarted',
                details => {
                    if ( details.tabId === -1 ) { return; }
                    const pageStore = µb.pageStoreFromTabId(details.tabId);
                    if ( pageStore === null ) { return; }
                    if ( pageStore.getNetFilteringSwitch() === false ) { return; }
                    scriptletFilteringEngine.injectNow(details);
                },
                {
                    types: [ 'main_frame', 'sub_frame' ],
                    urls: [ 'http://*/*', 'https://*/*' ]
                }
            );
            vAPI.defer.once({ sec: µb.hiddenSettings.toolbarWarningTimeout }).then(( ) => {
                if ( vAPI.net.hasUnprocessedRequest() === false ) { return; }
                vAPI.net.removeUnprocessedRequest();
                return vAPI.tabs.getCurrent();
            }).then(tab => {
                if ( tab instanceof Object === false ) { return; }
                µb.updateToolbarIcon(tab.id, 0b0110);
            });
            vAPI.net.unsuspend({ all: true });
        };
    })(),

    strictBlockBypass: hostname => {
        strictBlockBypasser.bypass(hostname);
    },
};

/******************************************************************************/

export default webRequest;

/******************************************************************************/
