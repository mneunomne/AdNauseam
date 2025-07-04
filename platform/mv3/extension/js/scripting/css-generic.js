/*******************************************************************************

    AdNauseam Lite - a comprehensive, MV3-compliant content blocker
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

/******************************************************************************/

// Important!
// Isolate from global scope
(function uBOL_cssGeneric() {

const genericSelectorMap = self.genericSelectorMap || new Map();
self.genericSelectorMap = undefined;
if ( genericSelectorMap.size === 0 ) { return; }

const genericExceptionSieve = self.genericExceptionSieve || new Set();
self.genericExceptionSieve = undefined;

const genericExceptionMap = self.genericExceptionMap || new Map();
self.genericExceptionMap = undefined;

/******************************************************************************/

const maxSurveyTimeSlice = 4;
const maxSurveyNodeSlice = 64;
const styleSheetSelectors = [];
const stopAllRatio = 0.95; // To be investigated

let surveyCount = 0;
let surveyMissCount = 0;
let styleSheetTimer;
let processTimer;
let domChangeTimer;
let lastDomChange = Date.now();

/******************************************************************************/

// http://www.cse.yorku.ca/~oz/hash.html#djb2
//   Must mirror dnrRulesetFromRawLists's version

const hashFromStr = (type, s) => {
    const len = s.length;
    const step = len + 7 >>> 3;
    let hash = (type << 5) + type ^ len;
    for ( let i = 0; i < len; i += step ) {
        hash = (hash << 5) + hash ^ s.charCodeAt(i);
    }
    return hash & 0xFFFFFF;
};

/******************************************************************************/

// Extract all classes/ids: these will be passed to the cosmetic
// filtering engine, and in return we will obtain only the relevant
// CSS selectors.

// https://github.com/gorhill/uBlock/issues/672
// http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
// http://jsperf.com/enumerate-classes/6

const uBOL_idFromNode = (node, out) => {
    const raw = node.id;
    if ( typeof raw !== 'string' || raw.length === 0 ) { return; }
    const hash = hashFromStr(0x23 /* '#' */, raw.trim());
    const selectorList = genericSelectorMap.get(hash);
    if ( selectorList === undefined ) { return; }
    genericSelectorMap.delete(hash);
    if ( genericExceptionSieve.has(hash) ) {
        applyExceptions(selectorList, out);
    } else {
        out.push(selectorList);
    }
};

// https://github.com/uBlockOrigin/uBlock-issues/discussions/2076
//   Performance: avoid using Element.classList
const uBOL_classesFromNode = (node, out) => {
    const s = node.getAttribute('class');
    if ( typeof s !== 'string' ) { return; }
    const len = s.length;
    for ( let beg = 0, end = 0; beg < len; beg += 1 ) {
        end = s.indexOf(' ', beg);
        if ( end === beg ) { continue; }
        if ( end === -1 ) { end = len; }
        const token = s.slice(beg, end).trimEnd();
        beg = end;
        if ( token.length === 0 ) { continue; }
        const hash = hashFromStr(0x2E /* '.' */, token);
        const selectorList = genericSelectorMap.get(hash);
        if ( selectorList === undefined ) { continue; }
        genericSelectorMap.delete(hash);
        if ( genericExceptionSieve.has(hash) ) {
            applyExceptions(selectorList, out);
        } else {
            out.push(selectorList);
        }
    }
};

const applyExceptions = (selectorList, out) => {
    const selectors = new Set(selectorList.split(',\n'));
    self.isolatedAPI.forEachHostname(hostname => {
        const exceptions = genericExceptionMap.get(hostname);
        if ( exceptions === undefined ) { return; }
        for ( const exception of exceptions.split('\n') ) {
            selectors.delete(exception);
        }
        if ( selectors.size === 0 ) { return true; }
    }, { hasEntities: true });
    if ( selectors.size === 0 ) { return; }
    out.push(Array.from(selectors).join(',\n'));
}

/******************************************************************************/

const pendingNodes = {
    addedNodes: [],
    nodeSet: new Set(),
    add(node) {
        this.addedNodes.push(node);
    },
    next(out) {
        for ( const added of this.addedNodes ) {
            if ( this.nodeSet.has(added) ) { continue; }
            if ( added.nodeType === 1 ) {
                this.nodeSet.add(added);
            }
            if ( added.firstElementChild === null ) { continue; }
            for ( const descendant of added.querySelectorAll('[id],[class]') ) {
                this.nodeSet.add(descendant);
            }
        }
        this.addedNodes.length = 0;
        for ( const node of this.nodeSet ) {
            this.nodeSet.delete(node);
            out.push(node);
            if ( out.length === maxSurveyNodeSlice ) { break; }
        }
    },
    hasNodes() {
        return this.addedNodes.length !== 0 || this.nodeSet.size !== 0;
    },
};

/******************************************************************************/

const uBOL_processNodes = ( ) => {
    const t0 = Date.now();
    const nodes = [];
    const deadline = t0 + maxSurveyTimeSlice;
    for (;;) {
        pendingNodes.next(nodes);
        if ( nodes.length === 0 ) { break; }
        for ( const node of nodes ) {
            uBOL_idFromNode(node, styleSheetSelectors);
            uBOL_classesFromNode(node, styleSheetSelectors);
        }
        nodes.length = 0;
        if ( performance.now() >= deadline ) { break; }
    }
    surveyCount += 1;
    if ( styleSheetSelectors.length === 0 ) {
        surveyMissCount += 1;
        if (
            surveyCount >= 100 &&
            (surveyMissCount / surveyCount) >= stopAllRatio
        ) {
            stopAll(`too many misses in surveyor (${surveyMissCount}/${surveyCount})`);
        }
        return;
    }
    if ( styleSheetTimer !== undefined ) { return; }
    styleSheetTimer = self.requestAnimationFrame(( ) => {
        styleSheetTimer = undefined;
        uBOL_injectCSS(`${styleSheetSelectors.join(',')}{display:none!important;}`);
        styleSheetSelectors.length = 0;
    });
};

/******************************************************************************/

const uBOL_processChanges = mutations => {
    for ( let i = 0; i < mutations.length; i++ ) {
        const mutation = mutations[i];
        for ( const added of mutation.addedNodes ) {
            if ( added.nodeType !== 1 ) { continue; }
            pendingNodes.add(added);
        }
    }
    if ( pendingNodes.hasNodes() === false ) { return; }
    lastDomChange = Date.now();
    if ( processTimer !== undefined ) { return; }
    processTimer = self.setTimeout(( ) => {
        processTimer = undefined;
        uBOL_processNodes();
    }, 64);
};

/******************************************************************************/

const uBOL_injectCSS = css => {
    chrome.runtime.sendMessage({
        what: 'insertCSS',
        css,
    }).catch(( ) => {
    });
};

/******************************************************************************/

const stopAll = reason => {
    if ( domChangeTimer !== undefined ) {
        self.clearTimeout(domChangeTimer);
        domChangeTimer = undefined;
    }
    domMutationObserver.disconnect();
    domMutationObserver.takeRecords();
    domMutationObserver = undefined;
    genericSelectorMap.clear();
    console.info(`uBOL: Generic cosmetic filtering stopped because ${reason}`);
};

/******************************************************************************/

pendingNodes.add(document);
uBOL_processNodes();

let domMutationObserver = new MutationObserver(uBOL_processChanges);
domMutationObserver.observe(document, {
    childList: true,
    subtree: true,
});

const needDomChangeObserver = ( ) => {
    domChangeTimer = undefined;
    if ( domMutationObserver === undefined ) { return; }
    if ( (Date.now() - lastDomChange) > 20000 ) {
        return stopAll('no more DOM changes');
    }
    domChangeTimer = self.setTimeout(needDomChangeObserver, 20000);
};

needDomChangeObserver();

/******************************************************************************/

})();

/******************************************************************************/
