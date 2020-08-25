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
    along with this program.  If not, see { This starts bootstrap process.http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

'use strict';

console.log('contentscript.js: '+location.href, (window.self !== window.top?'[iframe]':''));

/*******************************************************************************

              +--> domCollapser
              |
              |
  domWatcher--+
              |                  +-- domSurveyor
              |                  |
              +--> domFilterer --+-- domLogger
                                 |
                                 +-- domInspector

  domWatcher:
    Watches for changes in the DOM, and notify the other components about these
    changes.

  domCollapser:
    Enforces the collapsing of DOM elements for which a corresponding
    resource was blocked through network filtering.

  domFilterer:
    Enforces the filtering of DOM elements, by feeding it cosmetic filters.

  domSurveyor:
    Surveys the DOM to find new cosmetic filters to apply to the current page.

  domLogger:
    Surveys the page to find and report the injected cosmetic filters blocking
    actual elements on the current page. This component is dynamically loaded
    IF AND ONLY IF uBO's logger is opened.

  If page is whitelisted:
    - domWatcher: off
    - domCollapser: off
    - domFilterer: off
    - domSurveyor: off
    - domLogger: off

  I verified that the code in this file is completely flushed out of memory
  when a page is whitelisted.

  If cosmetic filtering is disabled:
    - domWatcher: on
    - domCollapser: on
    - domFilterer: off
    - domSurveyor: off
    - domLogger: off

  If generic cosmetic filtering is disabled:
    - domWatcher: on
    - domCollapser: on
    - domFilterer: on
    - domSurveyor: off
    - domLogger: on if uBO logger is opened

  If generic cosmetic filtering is enabled:
    - domWatcher: on
    - domCollapser: on
    - domFilterer: on
    - domSurveyor: on
    - domLogger: on if uBO logger is opened

  Additionally, the domSurveyor can turn itself off once it decides that
  it has become pointless (repeatedly not finding new cosmetic filters).

  The domFilterer makes use of platform-dependent user stylesheets[1].

  At time of writing, only modern Firefox provides a custom implementation,
  which makes for solid, reliable and low overhead cosmetic filtering on
  Firefox.

  The generic implementation[2] performs as best as can be, but won't ever be
  as reliable and accurate as real user stylesheets.

  [1] "user stylesheets" refer to local CSS rules which have priority over,
       and can't be overriden by a web page's own CSS rules.
  [2] below, see platformUserCSS / platformHideNode / platformUnhideNode

*/

// Abort execution if our global vAPI object does not exist.
//   https://github.com/chrisaljoudi/uBlock/issues/456
//   https://github.com/gorhill/uBlock/issues/2029

 // >>>>>>>> start of HUGE-IF-BLOCK
if ( typeof vAPI === 'object' && !vAPI.contentScript ) {

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.contentScript = true;

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/688#issuecomment-663657508
{
    let context = self;
    try {
        while (
            context !== self.top &&
            context.location.protocol === 'about:'
        ) {
            context = context.parent;
        }
    } catch(ex) {
    }
    vAPI.effectiveSelf = context;
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.userStylesheet = {
    added: new Set(),
    removed: new Set(),
    apply: function(callback) {
        if ( this.added.size === 0 && this.removed.size === 0 ) { return; }
        vAPI.messaging.send('vapi', {
            what: 'userCSS',
            add: Array.from(this.added),
            remove: Array.from(this.removed),
        }).then(( ) => {
            if ( callback instanceof Function === false ) { return; }
            callback();
        });
        this.added.clear();
        this.removed.clear();
    },
    add: function(cssText, now) {
        if ( cssText === '' ) { return; }
        this.added.add(cssText);
        if ( now ) { this.apply(); }
    },
    remove: function(cssText, now) {
        if ( cssText === '' ) { return; }
        this.removed.add(cssText);
        if ( now ) { this.apply(); }
    }
};

/******************************************************************************/
/******************************************************************************/
/*******************************************************************************

  The purpose of SafeAnimationFrame is to take advantage of the behavior of
  window.requestAnimationFrame[1]. If we use an animation frame as a timer,
  then this timer is described as follow:

  - time events are throttled by the browser when the viewport is not visible --
    there is no point for uBO to play with the DOM if the document is not
    visible.
  - time events are micro tasks[2].
  - time events are synchronized to monitor refresh, meaning that they can fire
    at most 1/60 (typically).

  If a delay value is provided, a plain timer is first used. Plain timers are
  macro-tasks, so this is good when uBO wants to yield to more important tasks
  on a page. Once the plain timer elapse, an animation frame is used to trigger
  the next time at which to execute the job.

  [1] https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame
  [2] https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/

*/

vAPI.useShadowDOM = false; // ADN

// https://github.com/gorhill/uBlock/issues/2147

vAPI.SafeAnimationFrame = class {
    constructor(callback) {
        this.fid = this.tid = undefined;
        this.callback = callback;
    }
    start(delay) {
        if ( self.vAPI instanceof Object === false ) { return; }
        if ( delay === undefined ) {
            if ( this.fid === undefined ) {
                this.fid = requestAnimationFrame(( ) => { this.onRAF(); } );
            }
            if ( this.tid === undefined ) {
                this.tid = vAPI.setTimeout(( ) => { this.onSTO(); }, 20000);
            }
            return;
        }
        if ( this.fid === undefined && this.tid === undefined ) {
            this.tid = vAPI.setTimeout(( ) => { this.macroToMicro(); }, delay);
        }
    }
    clear() {
        if ( this.fid !== undefined ) {
            cancelAnimationFrame(this.fid);
            this.fid = undefined;
        }
        if ( this.tid !== undefined ) {
            clearTimeout(this.tid);
            this.tid = undefined;
        }
    }
    macroToMicro() {
        this.tid = undefined;
        this.start();
    }
    onRAF() {
        if ( this.tid !== undefined ) {
            clearTimeout(this.tid);
            this.tid = undefined;
        }
        this.fid = undefined;
        this.callback();
    }
    onSTO() {
        if ( this.fid !== undefined ) {
            cancelAnimationFrame(this.fid);
            this.fid = undefined;
        }
        this.tid = undefined;
        this.callback();
    }
};

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/552
//   Listen and report CSP violations so that blocked resources through CSP
//   are properly reported in the logger.

{
    const newEvents = new Set();
    const allEvents = new Set();
    let timer;

    const send = function() {
        vAPI.messaging.send('scriptlets', {
            what: 'securityPolicyViolation',
            type: 'net',
            docURL: document.location.href,
            violations: Array.from(newEvents),
        }).then(response => {
            if ( response === true ) { return; }
            stop();
        });
        for ( const event of newEvents ) {
            allEvents.add(event);
        }
        newEvents.clear();
    };

    const sendAsync = function() {
        if ( timer !== undefined ) { return; }
        timer = self.requestIdleCallback(
            ( ) => { timer = undefined; send(); },
            { timeout: 2063 }
        );
    };

    const listener = function(ev) {
        if ( ev.isTrusted !== true ) { return; }
        if ( ev.disposition !== 'enforce' ) { return; }
        const json = JSON.stringify({
            url: ev.blockedURL || ev.blockedURI,
            policy: ev.originalPolicy,
            directive: ev.effectiveDirective || ev.violatedDirective,
        });
        if ( allEvents.has(json) ) { return; }
        newEvents.add(json);
        sendAsync();
    };

    const stop = function() {
        newEvents.clear();
        allEvents.clear();
        if ( timer !== undefined ) {
            self.cancelIdleCallback(timer);
            timer = undefined;
        }
        document.removeEventListener('securitypolicyviolation', listener);
        vAPI.shutdown.remove(stop);
    };

    document.addEventListener('securitypolicyviolation', listener);
    vAPI.shutdown.add(stop);

    // We need to call at least once to find out whether we really need to
    // listen to CSP violations.
    sendAsync();
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// vAPI.domWatcher

{
    vAPI.domMutationTime = Date.now();

    const addedNodeLists = [];
    const removedNodeLists = [];
    const addedNodes = [];
    const ignoreTags = new Set([ 'br', 'head', 'link', 'meta', 'script', 'style' ]);
    const listeners = [];

    let domLayoutObserver;
    let listenerIterator = [];
    let listenerIteratorDirty = false;
    let removedNodes = false;
    let safeObserverHandlerTimer;

    const safeObserverHandler = function() {
        let i = addedNodeLists.length;
        while ( i-- ) {
            const nodeList = addedNodeLists[i];
            let iNode = nodeList.length;
            while ( iNode-- ) {
                const node = nodeList[iNode];
                if ( node.nodeType !== 1 ) { continue; }
                if ( ignoreTags.has(node.localName) ) { continue; }
                if ( node.parentElement === null ) { continue; }
                addedNodes.push(node);
            }
        }
        addedNodeLists.length = 0;
        i = removedNodeLists.length;
        while ( i-- && removedNodes === false ) {
            const nodeList = removedNodeLists[i];
            let iNode = nodeList.length;
            while ( iNode-- ) {
                if ( nodeList[iNode].nodeType !== 1 ) { continue; }
                removedNodes = true;
                break;
            }
        }
        removedNodeLists.length = 0;
        if ( addedNodes.length === 0 && removedNodes === false ) { return; }
        for ( const listener of getListenerIterator() ) {
            try { listener.onDOMChanged(addedNodes, removedNodes); }
            catch (ex) { }
        }
        addedNodes.length = 0;
        removedNodes = false;
        vAPI.domMutationTime = Date.now();
    };

    // https://github.com/chrisaljoudi/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    const observerHandler = function(mutations) {
        let i = mutations.length;
        while ( i-- ) {
            const mutation = mutations[i];
            let nodeList = mutation.addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
            nodeList = mutation.removedNodes;
            if ( nodeList.length !== 0 ) {
                removedNodeLists.push(nodeList);
            }
        }
        if ( addedNodeLists.length !== 0 || removedNodes ) {
            safeObserverHandlerTimer.start(
                addedNodeLists.length < 100 ? 1 : undefined
            );
        }
    };

    const startMutationObserver = function() {
        if ( domLayoutObserver !== undefined ) { return; }
        domLayoutObserver = new MutationObserver(observerHandler);
        domLayoutObserver.observe(document.documentElement, {
            //attributeFilter: [ 'class', 'id' ],
            //attributes: true,
            childList: true,
            subtree: true
        });
        safeObserverHandlerTimer = new vAPI.SafeAnimationFrame(safeObserverHandler);
        vAPI.shutdown.add(cleanup);
    };

    const stopMutationObserver = function() {
        if ( domLayoutObserver === undefined ) { return; }
        cleanup();
        vAPI.shutdown.remove(cleanup);
    };

    const getListenerIterator = function() {
        if ( listenerIteratorDirty ) {
            listenerIterator = listeners.slice();
            listenerIteratorDirty = false;
        }
        return listenerIterator;
    };

    const addListener = function(listener) {
        if ( listeners.indexOf(listener) !== -1 ) { return; }
        listeners.push(listener);
        listenerIteratorDirty = true;
        if ( domLayoutObserver === undefined ) { return; }
        try { listener.onDOMCreated(); }
        catch (ex) { }
        startMutationObserver();
    };

    const removeListener = function(listener) {
        const pos = listeners.indexOf(listener);
        if ( pos === -1 ) { return; }
        listeners.splice(pos, 1);
        listenerIteratorDirty = true;
        if ( listeners.length === 0 ) {
            stopMutationObserver();
        }
    };

    const cleanup = function() {
        if ( domLayoutObserver !== undefined ) {
            domLayoutObserver.disconnect();
            domLayoutObserver = null;
        }
        if ( safeObserverHandlerTimer !== undefined ) {
            safeObserverHandlerTimer.clear();
            safeObserverHandlerTimer = undefined;
        }
    };

    const start = function() {
        for ( const listener of getListenerIterator() ) {
            try { listener.onDOMCreated(); }
            catch (ex) { }
        }
        startMutationObserver();
    };

    vAPI.domWatcher = { start, addListener, removeListener };
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

vAPI.injectScriptlet = function(doc, text) {
    if ( !doc ) { return; }
    let script;
    try {
        script = doc.createElement('script');
        script.appendChild(doc.createTextNode(text));
        (doc.head || doc.documentElement).appendChild(script);
    } catch (ex) {
    }
    if ( script ) {
        if ( script.parentNode ) {
            script.parentNode.removeChild(script);
        }
        script.textContent = '';
    }
};

/******************************************************************************/
/******************************************************************************/
/*******************************************************************************

  The DOM filterer is the heart of uBO's cosmetic filtering.

  DOMFilterer: adds procedural cosmetic filtering

*/

{
    // 'P' stands for 'Procedural'

    const PSelectorHasTextTask = class {
        constructor(task) {
            let arg0 = task[1], arg1;
            if ( Array.isArray(task[1]) ) {
                arg1 = arg0[1]; arg0 = arg0[0];
            }
            this.needle = new RegExp(arg0, arg1);
        }
        transpose(node, output) {
            if ( this.needle.test(node.textContent) ) {
                output.push(node);
            }
        }
    };

    const PSelectorIfTask = class {
        constructor(task) {
            this.pselector = new PSelector(task[1]);
        }
        transpose(node, output) {
            if ( this.pselector.test(node) === this.target ) {
                output.push(node);
            }
        }
    };
    PSelectorIfTask.prototype.target = true;

    const PSelectorIfNotTask = class extends PSelectorIfTask {
    };
    PSelectorIfNotTask.prototype.target = false;

    const PSelectorMatchesCSSTask = class {
        constructor(task) {
            this.name = task[1].name;
            let arg0 = task[1].value, arg1;
            if ( Array.isArray(arg0) ) {
                arg1 = arg0[1]; arg0 = arg0[0];
            }
            this.value = new RegExp(arg0, arg1);
        }
        transpose(node, output) {
            const style = window.getComputedStyle(node, this.pseudo);
            if ( style !== null && this.value.test(style[this.name]) ) {
                output.push(node);
            }
        }
    };
    PSelectorMatchesCSSTask.prototype.pseudo = null;

    const PSelectorMatchesCSSAfterTask = class extends PSelectorMatchesCSSTask {
    };
    PSelectorMatchesCSSAfterTask.prototype.pseudo = ':after';

    const PSelectorMatchesCSSBeforeTask = class extends PSelectorMatchesCSSTask {
    };
    PSelectorMatchesCSSBeforeTask.prototype.pseudo = ':before';

    const PSelectorMinTextLengthTask = class {
        constructor(task) {
            this.min = task[1];
        }
        transpose(node, output) {
            if ( node.textContent.length >= this.min ) {
                output.push(node);
            }
        }
    };

    const PSelectorPassthru = class {
        constructor() {
        }
        transpose(node, output) {
            output.push(node);
        }
    };

    const PSelectorSpathTask = class {
        constructor(task) {
            this.spath = task[1];
            this.nth = /^(?:\s*[+~]|:)/.test(this.spath);
            if ( this.nth ) { return; }
            if ( /^\s*>/.test(this.spath) ) {
                this.spath = `:scope ${this.spath.trim()}`;
            }
        }
        qsa(node) {
            if ( this.nth === false ) {
                return node.querySelectorAll(this.spath);
            }
            const parent = node.parentElement;
            if ( parent === null ) { return; }
            let pos = 1;
            for (;;) {
                node = node.previousElementSibling;
                if ( node === null ) { break; }
                pos += 1;
            }
            return parent.querySelectorAll(
                `:scope > :nth-child(${pos})${this.spath}`
            );
        }
        transpose(node, output) {
            const nodes = this.qsa(node);
            if ( nodes === undefined ) { return; }
            for ( const node of nodes ) {
                output.push(node);
            }
        }
    };

    const PSelectorUpwardTask = class {
        constructor(task) {
            const arg = task[1];
            if ( typeof arg === 'number' ) {
                this.i = arg;
            } else {
                this.s = arg;
            }
        }
        transpose(node, output) {
            if ( this.s !== '' ) {
                const parent = node.parentElement;
                if ( parent === null ) { return; }
                node = parent.closest(this.s);
                if ( node === null ) { return; }
            } else {
                let nth = this.i;
                for (;;) {
                    node = node.parentElement;
                    if ( node === null ) { return; }
                    nth -= 1;
                    if ( nth === 0 ) { break; }
                }
            }
            output.push(node);
        }
    };
    PSelectorUpwardTask.prototype.i = 0;
    PSelectorUpwardTask.prototype.s = '';

    const PSelectorWatchAttrs = class {
        constructor(task) {
            this.observer = null;
            this.observed = new WeakSet();
            this.observerOptions = {
                attributes: true,
                subtree: true,
            };
            const attrs = task[1];
            if ( Array.isArray(attrs) && attrs.length !== 0 ) {
                this.observerOptions.attributeFilter = task[1];
            }
        }
        // TODO: Is it worth trying to re-apply only the current selector?
        handler() {
            const filterer =
                vAPI.domFilterer && vAPI.domFilterer.proceduralFilterer;
            if ( filterer instanceof Object ) {
                filterer.onDOMChanged([ null ]);
            }
        }
        transpose(node, output) {
            output.push(node);
            if ( this.observed.has(node) ) { return; }
            if ( this.observer === null ) {
                this.observer = new MutationObserver(this.handler);
            }
            this.observer.observe(node, this.observerOptions);
            this.observed.add(node);
        }
    };

    const PSelectorXpathTask = class {
        constructor(task) {
            this.xpe = document.createExpression(task[1], null);
            this.xpr = null;
        }
        transpose(node, output) {
            this.xpr = this.xpe.evaluate(
                node,
                XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
                this.xpr
            );
            let j = this.xpr.snapshotLength;
            while ( j-- ) {
                const node = this.xpr.snapshotItem(j);
                if ( node.nodeType === 1 ) {
                    output.push(node);
                }
            }
        }
    };

    const PSelector = class {
        constructor(o) {
            if ( PSelector.prototype.operatorToTaskMap === undefined ) {
                PSelector.prototype.operatorToTaskMap = new Map([
                    [ ':has', PSelectorIfTask ],
                    [ ':has-text', PSelectorHasTextTask ],
                    [ ':if', PSelectorIfTask ],
                    [ ':if-not', PSelectorIfNotTask ],
                    [ ':matches-css', PSelectorMatchesCSSTask ],
                    [ ':matches-css-after', PSelectorMatchesCSSAfterTask ],
                    [ ':matches-css-before', PSelectorMatchesCSSBeforeTask ],
                    [ ':min-text-length', PSelectorMinTextLengthTask ],
                    [ ':not', PSelectorIfNotTask ],
                    [ ':nth-ancestor', PSelectorUpwardTask ],
                    [ ':remove', PSelectorPassthru ],
                    [ ':spath', PSelectorSpathTask ],
                    [ ':upward', PSelectorUpwardTask ],
                    [ ':watch-attr', PSelectorWatchAttrs ],
                    [ ':xpath', PSelectorXpathTask ],
                ]);
            }
            this.budget = 200; // I arbitrary picked a 1/5 second
            this.raw = o.raw;
            this.cost = 0;
            this.lastAllowanceTime = 0;
            this.selector = o.selector;
            this.tasks = [];
            const tasks = o.tasks;
            if ( Array.isArray(tasks) ) {
                for ( const task of tasks ) {
                    this.tasks.push(
                        new (this.operatorToTaskMap.get(task[0]))(task)
                    );
                }
            }
            if ( o.action !== undefined ) {
                this.action = o.action;
            }
        }
        prime(input) {
            const root = input || document;
            if ( this.selector === '' ) { return [ root ]; }
            return Array.from(root.querySelectorAll(this.selector));
        }
        exec(input) {
            let nodes = this.prime(input);
            for ( const task of this.tasks ) {
                if ( nodes.length === 0 ) { break; }
                const transposed = [];
                for ( const node of nodes ) {
                    task.transpose(node, transposed);
                }
                nodes = transposed;
            }
            return nodes;
        }
        test(input) {
            const nodes = this.prime(input);
            for ( const node of nodes ) {
                let output = [ node ];
                for ( const task of this.tasks ) {
                    const transposed = [];
                    for ( const node of output ) {
                        task.transpose(node, transposed);
                    }
                    output = transposed;
                    if ( output.length === 0 ) { break; }
                }
                if ( output.length !== 0 ) { return true; }
            }
            return false;
        }
    };
    PSelector.prototype.action = undefined;
    PSelector.prototype.hit = false;
    PSelector.prototype.operatorToTaskMap = undefined;

    const DOMProceduralFilterer = class {
        constructor(domFilterer) {
            this.domFilterer = domFilterer;
            this.domIsReady = false;
            this.domIsWatched = false;
            this.mustApplySelectors = false;
            this.selectors = new Map();
            this.hiddenNodes = new Set();
            if ( vAPI.domWatcher instanceof Object ) {
                vAPI.domWatcher.addListener(this);
            }
        }

        addProceduralSelectors(aa) {
            const addedSelectors = [];
            let mustCommit = this.domIsWatched;
            for ( let i = 0, n = aa.length; i < n; i++ ) {
                const raw = aa[i];
                const o = JSON.parse(raw);
                if ( o.action === 'style' ) {
                    this.domFilterer.addCSSRule(o.selector, o.tasks[0][1]);
                    mustCommit = true;
                    continue;
                }
                if ( o.pseudo !== undefined ) {
                    this.domFilterer.addCSSRule(
                        o.selector,
                        'display:none!important;'
                    );
                    mustCommit = true;
                    continue;
                }
                if ( o.tasks !== undefined ) {
                    if ( this.selectors.has(raw) === false ) {
                        const pselector = new PSelector(o);
                        this.selectors.set(raw, pselector);
                        addedSelectors.push(pselector);
                        mustCommit = true;
                    }
                    continue;
                }
            }
            if ( mustCommit === false ) { return; }
            this.mustApplySelectors = this.selectors.size !== 0;
            this.domFilterer.commit();
            if ( this.domFilterer.hasListeners() ) {
                this.domFilterer.triggerListeners({
                    procedural: addedSelectors
                });
            }
        }

        commitNow() {
            if ( this.selectors.size === 0 || this.domIsReady === false ) {
                return;
            }

            this.mustApplySelectors = false;

            //console.time('procedural selectors/dom layout changed');

            // https://github.com/uBlockOrigin/uBlock-issues/issues/341
            //   Be ready to unhide nodes which no longer matches any of
            //   the procedural selectors.
            const toRemove = this.hiddenNodes;
            this.hiddenNodes = new Set();

            let t0 = Date.now();

            for ( const pselector of this.selectors.values() ) {
                const allowance = Math.floor((t0 - pselector.lastAllowanceTime) / 2000);
                if ( allowance >= 1 ) {
                    pselector.budget += allowance * 50;
                    if ( pselector.budget > 200 ) { pselector.budget = 200; }
                    pselector.lastAllowanceTime = t0;
                }
                if ( pselector.budget <= 0 ) { continue; }
                const nodes = pselector.exec();
                const t1 = Date.now();
                pselector.budget += t0 - t1;
                if ( pselector.budget < -500 ) {
                    console.info('uBO: disabling %s', pselector.raw);
                    pselector.budget = -0x7FFFFFFF;
                }
                t0 = t1;
                if ( nodes.length === 0 ) { continue; }
                pselector.hit = true;
                if ( pselector.action === 'remove' ) {
                    this.removeNodes(nodes);
                } else {
                    this.hideNodes(nodes);
                }
            }

            for ( const node of toRemove ) {
                if ( this.hiddenNodes.has(node) ) { continue; }
                this.domFilterer.unhideNode(node);
            }
            //console.timeEnd('procedural selectors/dom layout changed');
        }

        hideNodes(nodes) {
            for ( const node of nodes ) {
                if ( node.parentElement === null ) { continue; }
                this.domFilterer.hideNode(node);
                this.hiddenNodes.add(node);
            }
        }

        removeNodes(nodes) {
            for ( const node of nodes ) {
                node.textContent = '';
                node.remove();
            }
        }

        createProceduralFilter(o) {
            return new PSelector(o);
        }

        onDOMCreated() {
            this.domIsReady = true;
            this.domFilterer.commit();
        }

        onDOMChanged(addedNodes, removedNodes) {
            if ( this.selectors.size === 0 ) { return; }
            this.mustApplySelectors =
                this.mustApplySelectors ||
                addedNodes.length !== 0 ||
                removedNodes;
            this.domFilterer.commit();
        }
    };

    vAPI.DOMFilterer = class {
        constructor() {
            this.commitTimer = new vAPI.SafeAnimationFrame(
                ( ) => { this.commitNow(); }
            );
            this.domIsReady = document.readyState !== 'loading';
            this.disabled = false;
            this.listeners = [];
            this.filterset = new Set();
            this.excludedNodeSet = new WeakSet();
            this.addedCSSRules = new Set();
            this.exceptedCSSRules = [];
            this.reOnlySelectors = /\n\{[^\n]+/g;
            this.exceptions = [];
            this.proceduralFilterer = null;
            this.hideNodeAttr = undefined;
            this.hideNodeStyleSheetInjected = false;
            // https://github.com/uBlockOrigin/uBlock-issues/issues/167
            //   By the time the DOMContentLoaded is fired, the content script might
            //   have been disconnected from the background page. Unclear why this
            //   would happen, so far seems to be a Chromium-specific behavior at
            //   launch time.
            if ( this.domIsReady !== true ) {
                document.addEventListener('DOMContentLoaded', ( ) => {
                    if ( vAPI instanceof Object === false ) { return; }
                    this.domIsReady = true;
                    this.commit();
                });
            }
        }

        addCSSRule(selectors, declarations, details = {}) {
            if ( selectors === undefined ) { return; }
            const selectorsStr = Array.isArray(selectors)
                    ? selectors.join(',\n')
                    : selectors;
            if ( selectorsStr.length === 0 ) { return; }
            const entry = {
                selectors: selectorsStr,
                declarations,
                lazy: details.lazy === true,
                injected: details.injected === true
            };
            this.addedCSSRules.add(entry);
            this.filterset.add(entry);
            if (
                this.disabled === false &&
                entry.lazy !== true &&
                entry.injected !== true
            ) {
                vAPI.userStylesheet.add(`${selectorsStr}\n{${declarations}}`);
            }
            this.commit();
            if ( details.silent !== true && this.hasListeners() ) {
                this.triggerListeners({
                    declarative: [ [ selectorsStr, declarations ] ]
                });
            }
        }

        exceptCSSRules(exceptions) {
            if ( exceptions.length === 0 ) { return; }
            this.exceptedCSSRules.push(...exceptions);
            if ( this.hasListeners() ) {
                this.triggerListeners({ exceptions });
            }
        }

        addListener(listener) {
            if ( this.listeners.indexOf(listener) !== -1 ) { return; }
            this.listeners.push(listener);
        }

        removeListener(listener) {
            const pos = this.listeners.indexOf(listener);
            if ( pos === -1 ) { return; }
            this.listeners.splice(pos, 1);
        }

        hasListeners() {
            return this.listeners.length !== 0;
        }

        triggerListeners(changes) {
            for ( const listener of this.listeners ) {
                listener.onFiltersetChanged(changes);
            }
        }

        excludeNode(node) {
            this.excludedNodeSet.add(node);
            this.unhideNode(node);
        }

        unexcludeNode(node) {
            this.excludedNodeSet.delete(node);
        }

        hideNode(node) {
            if ( this.excludedNodeSet.has(node) ) { return; }
            if ( this.hideNodeAttr === undefined ) { return; }
            node.setAttribute(this.hideNodeAttr, '');
            if ( this.hideNodeStyleSheetInjected ) { return; }
            this.hideNodeStyleSheetInjected = true;
            this.addCSSRule(
                `[${this.hideNodeAttr}]`,
                'display:none!important;',
                { silent: true }
            );
        }

        unhideNode(node) {
            if ( this.hideNodeAttr === undefined ) { return; }
            node.removeAttribute(this.hideNodeAttr);
        }

        toggle(state, callback) {
            if ( state === undefined ) { state = this.disabled; }
            if ( state !== this.disabled ) { return; }
            this.disabled = !state;
            const userStylesheet = vAPI.userStylesheet;
            for ( const entry of this.filterset ) {
                const rule = `${entry.selectors}\n{${entry.declarations}}`;
                if ( this.disabled ) {
                    userStylesheet.remove(rule);
                } else {
                    userStylesheet.add(rule);
                }
            }
            userStylesheet.apply(callback);
        }

        getAllSelectors_(all) {
            const out = {
                declarative: [],
                exceptions: this.exceptedCSSRules,
            };
            for ( const entry of this.filterset ) {
                let selectors = entry.selectors;
                if ( all !== true && this.hideNodeAttr !== undefined ) {
                    selectors = selectors
                                    .replace(`[${this.hideNodeAttr}]`, '')
                                    .replace(/^,\n|,\n$/gm, '');
                    if ( selectors === '' ) { continue; }
                }
                out.declarative.push([ selectors, entry.declarations ]);
            }
            return out;
        }

        // Here we will deal with:
        // - Injecting low priority user styles;
        // - Notifying listeners about changed filterset.
        // https://www.reddit.com/r/uBlockOrigin/comments/9jj0y1/no_longer_blocking_ads/
        //   Ensure vAPI is still valid -- it can go away by the time we are
        //   called, since the port could be force-disconnected from the main
        //   process. Another approach would be to have vAPI.SafeAnimationFrame
        //   register a shutdown job: to evaluate. For now I will keep the fix
        //   trivial.
        commitNow() {
            this.commitTimer.clear();
            if ( vAPI instanceof Object === false ) { return; }
            const userStylesheet = vAPI.userStylesheet;
            for ( const entry of this.addedCSSRules ) {
                if (
                    this.disabled === false &&
                    entry.lazy &&
                    entry.injected === false
                ) {
                    userStylesheet.add(
                        `${entry.selectors}\n{${entry.declarations}}`
                    );
                }
            }
            this.addedCSSRules.clear();
            userStylesheet.apply();
            if ( this.proceduralFilterer instanceof Object ) {
                this.proceduralFilterer.commitNow();
            }
        }

        commit(commitNow) {
            if ( commitNow ) {
                this.commitTimer.clear();
                this.commitNow();
            } else {
                this.commitTimer.start();
            }
        }

        proceduralFiltererInstance() {
            if ( this.proceduralFilterer instanceof Object === false ) {
                this.proceduralFilterer = new DOMProceduralFilterer(this);
            }
            return this.proceduralFilterer;
        }

        addProceduralSelectors(aa) {
            if ( aa.length === 0 ) { return; }
            this.proceduralFiltererInstance().addProceduralSelectors(aa);
        }

        createProceduralFilter(o) {
            return this.proceduralFiltererInstance().createProceduralFilter(o);
        }

        getAllSelectors() {
            const out = this.getAllSelectors_(false);
            out.procedural = this.proceduralFilterer instanceof Object
                ? Array.from(this.proceduralFilterer.selectors.values())
                : [];
            return out;
        }

        getAllExceptionSelectors() {
            return this.exceptions.join(',\n');
        }

        getFilteredElementCount() {
            const details = this.getAllSelectors_(true);
            if ( Array.isArray(details.declarative) === false ) { return 0; }
            const selectors = details.declarative.map(entry => entry[0]);
            if ( selectors.length === 0 ) { return 0; }
            return document.querySelectorAll(selectors.join(',\n')).length;
        }
    };
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// vAPI.domCollapser

{
    const messaging = vAPI.messaging;
    const toCollapse = new Map();
    const src1stProps = {
        embed: 'src',
        iframe: 'src',
        img: 'src',
        object: 'data'
    };
    const src2ndProps = {
        img: 'srcset'
    };
    const tagToTypeMap = {
        embed: 'object',
        iframe: 'sub_frame',
        img: 'image',
        object: 'object'
    };

    let resquestIdGenerator = 1,
        processTimer,
        cachedBlockedSet,
        cachedBlockedSetHash,
        cachedBlockedSetTimer,
        toProcess = [],
        toFilter = [],
        netSelectorCacheCount = 0;

    const cachedBlockedSetClear = function() {
        cachedBlockedSet =
        cachedBlockedSetHash =
        cachedBlockedSetTimer = undefined;
    };

    // https://github.com/chrisaljoudi/uBlock/issues/174
    //   Do not remove fragment from src URL
    const onProcessed = function(response) {
        // This happens if uBO is disabled or restarted.
        if ( response instanceof Object === false ) {
            toCollapse.clear();
            return;
        }

        const targets = toCollapse.get(response.id);
        if ( targets === undefined ) { return; }
        toCollapse.delete(response.id);
        if ( cachedBlockedSetHash !== response.hash ) {
            cachedBlockedSet = new Set(response.blockedResources);
            cachedBlockedSetHash = response.hash;
            if ( cachedBlockedSetTimer !== undefined ) {
                clearTimeout(cachedBlockedSetTimer);
            }
            cachedBlockedSetTimer = vAPI.setTimeout(cachedBlockedSetClear, 30000);
        }
        if ( cachedBlockedSet === undefined || cachedBlockedSet.size === 0 ) {
            return;
        }
        const selectors = [];
        const iframeLoadEventPatch = vAPI.iframeLoadEventPatch;
        let netSelectorCacheCountMax = response.netSelectorCacheCountMax;

        for ( const target of targets ) {
            const tag = target.localName;
            let prop = src1stProps[tag];
            if ( prop === undefined ) { continue; }
            let src = target[prop];
            if ( typeof src !== 'string' || src.length === 0 ) {
                prop = src2ndProps[tag];
                if ( prop === undefined ) { continue; }
                src = target[prop];
                if ( typeof src !== 'string' || src.length === 0 ) { continue; }
            }
            if ( cachedBlockedSet.has(tagToTypeMap[tag] + ' ' + src) === false ) {
                continue;
            }
            // https://github.com/chrisaljoudi/uBlock/issues/399
            // Never remove elements from the DOM, just hide them
            target.style.setProperty('display', 'none', 'important');
            target.hidden = true;
            // https://github.com/chrisaljoudi/uBlock/issues/1048
            // Use attribute to construct CSS rule
            if ( netSelectorCacheCount <= netSelectorCacheCountMax ) {
                const value = target.getAttribute(prop);
                if ( value ) {
                    selectors.push(`${tag}[${prop}="${CSS.escape(value)}"]`);
                    netSelectorCacheCount += 1;
                }
            }
            if ( iframeLoadEventPatch !== undefined ) {
                iframeLoadEventPatch(target);
            }
        }

        if ( selectors.length !== 0 ) {
            messaging.send('contentscript', {
                what: 'cosmeticFiltersInjected',
                type: 'net',
                hostname: window.location.hostname,
                selectors,
            });
        }
    };

    const send = function() {
        processTimer = undefined;
        toCollapse.set(resquestIdGenerator, toProcess);
        messaging.send('contentscript', {
            what: 'getCollapsibleBlockedRequests',
            id: resquestIdGenerator,
            frameURL: window.location.href,
            resources: toFilter,
            hash: cachedBlockedSetHash,
        }).then(response => {
            onProcessed(response);
        });
        toProcess = [];
        toFilter = [];
        resquestIdGenerator += 1;
    };

    const process = function(delay) {
        if ( toProcess.length === 0 ) { return; }
        if ( delay === 0 ) {
            if ( processTimer !== undefined ) {
                clearTimeout(processTimer);
            }
            send();
        } else if ( processTimer === undefined ) {
            processTimer = vAPI.setTimeout(send, delay || 20);
        }
    };

    const add = function(target) {
        toProcess[toProcess.length] = target;
    };

    const addMany = function(targets) {
        for ( const target of targets ) {
            add(target);
        }
    };

    const iframeSourceModified = function(mutations) {
        for ( const mutation of mutations ) {
            addIFrame(mutation.target, true);
        }
        process();
    };
    const iframeSourceObserver = new MutationObserver(iframeSourceModified);
    const iframeSourceObserverOptions = {
        attributes: true,
        attributeFilter: [ 'src' ]
    };

    // https://github.com/gorhill/uBlock/issues/162
    //   Be prepared to deal with possible change of src attribute.
    const addIFrame = function(iframe, dontObserve) {
        if ( dontObserve !== true ) {
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }
        const src = iframe.src;
        if ( typeof src !== 'string' || src === '' ) { return; }
        if ( src.startsWith('http') === false ) { return; }
        toFilter.push({ type: 'sub_frame', url: iframe.src });
        add(iframe);
    };

    const addIFrames = function(iframes) {
        for ( const iframe of iframes ) {
            addIFrame(iframe);
        }
    };

    const onResourceFailed = function(ev) {
        if ( tagToTypeMap[ev.target.localName] !== undefined ) {
            add(ev.target);
            process();
        }
    };

    const stop = function() {
        document.removeEventListener('error', onResourceFailed, true);
        if ( processTimer !== undefined ) {
            clearTimeout(processTimer);
        }
        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.removeListener(domWatcherInterface);
        }
        vAPI.shutdown.remove(stop);
        vAPI.domCollapser = null;
    };

    const start = function() {
        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.addListener(domWatcherInterface);
        }
    };

    const domWatcherInterface = {
        onDOMCreated: function() {
            if ( self.vAPI instanceof Object === false ) { return; }
            if ( vAPI.domCollapser instanceof Object === false ) {
                if ( vAPI.domWatcher instanceof Object ) {
                    vAPI.domWatcher.removeListener(domWatcherInterface);
                }
                return;
            }
            // Listener to collapse blocked resources.
            // - Future requests not blocked yet
            // - Elements dynamically added to the page
            // - Elements which resource URL changes
            // https://github.com/chrisaljoudi/uBlock/issues/7
            // Preferring getElementsByTagName over querySelectorAll:
            //   http://jsperf.com/queryselectorall-vs-getelementsbytagname/145
            const elems = document.images ||
                          document.getElementsByTagName('img');
            for ( const elem of elems ) {
                if ( elem.complete ) {
                    add(elem);
                }
            }
            addMany(document.embeds || document.getElementsByTagName('embed'));
            addMany(document.getElementsByTagName('object'));
            addIFrames(document.getElementsByTagName('iframe'));
            process(0);

            document.addEventListener('error', onResourceFailed, true);

            vAPI.shutdown.add(stop);
        },
        onDOMChanged: function(addedNodes) {
            if ( addedNodes.length === 0 ) { return; }
            for ( const node of addedNodes ) {
                if ( node.localName === 'iframe' ) {
                    addIFrame(node);
                }
                if ( node.childElementCount === 0 ) { continue; }
                const iframes = node.getElementsByTagName('iframe');
                if ( iframes.length !== 0 ) {
                    addIFrames(iframes);
                }
            }
            process();
        }
    };

    vAPI.domCollapser = { start };
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// vAPI.domSurveyor

{
    const messaging = vAPI.messaging;
    const queriedIds = new Set();
    const queriedClasses = new Set();
    const maxSurveyNodes = 65536;
    const maxSurveyTimeSlice = 4;
    const maxSurveyBuffer = 64;

    let domFilterer,
        hostname = '',
        surveyCost = 0;

    const pendingNodes = {
        nodeLists: [],
        buffer: [
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
        ],
        j: 0,
        accepted: 0,
        iterated: 0,
        stopped: false,
        add: function(nodes) {
            if ( nodes.length === 0 || this.accepted >= maxSurveyNodes ) {
                return;
            }
            this.nodeLists.push(nodes);
            this.accepted += nodes.length;
        },
        next: function() {
            if ( this.nodeLists.length === 0 || this.stopped ) { return 0; }
            const nodeLists = this.nodeLists;
            let ib = 0;
            do {
                const nodeList = nodeLists[0];
                let j = this.j;
                let n = j + maxSurveyBuffer - ib;
                if ( n > nodeList.length ) {
                    n = nodeList.length;
                }
                for ( let i = j; i < n; i++ ) {
                    this.buffer[ib++] = nodeList[j++];
                }
                if ( j !== nodeList.length ) {
                    this.j = j;
                    break;
                }
                this.j = 0;
                this.nodeLists.shift();
            } while ( ib < maxSurveyBuffer && nodeLists.length !== 0 );
            this.iterated += ib;
            if ( this.iterated >= maxSurveyNodes ) {
                this.nodeLists = [];
                this.stopped = true;
                //console.info(`domSurveyor> Surveyed a total of ${this.iterated} nodes. Enough.`);
            }
            return ib;
        },
        hasNodes: function() {
            return this.nodeLists.length !== 0;
        },
    };

    // Extract all classes/ids: these will be passed to the cosmetic
    // filtering engine, and in return we will obtain only the relevant
    // CSS selectors.
    const reWhitespace = /\s/;

    // https://github.com/gorhill/uBlock/issues/672
    // http://www.w3.org/TR/2014/REC-html5-20141028/infrastructure.html#space-separated-tokens
    // http://jsperf.com/enumerate-classes/6

    const surveyPhase1 = function() {
        // console.log('dom surveyor/surveying');
        const t0 = performance.now();
        const rews = reWhitespace;
        const ids = [];
        const classes = [];
        const nodes = pendingNodes.buffer;
        const deadline = t0 + maxSurveyTimeSlice;
        let qids = queriedIds;
        let qcls = queriedClasses;
        let processed = 0;
        for (;;) {
            const n = pendingNodes.next();
            if ( n === 0 ) { break; }
            for ( let i = 0; i < n; i++ ) {
                const node = nodes[i]; nodes[i] = null;
                let v = node.id;
                if ( typeof v === 'string' && v.length !== 0 ) {
                    v = v.trim();
                    if ( qids.has(v) === false && v.length !== 0 ) {
                        ids.push(v); qids.add(v);
                    }
                }
                let vv = node.className;
                if ( typeof vv === 'string' && vv.length !== 0 ) {
                    if ( rews.test(vv) === false ) {
                        if ( qcls.has(vv) === false ) {
                            classes.push(vv); qcls.add(vv);
                        }
                    } else {
                        vv = node.classList;
                        let j = vv.length;
                        while ( j-- ) {
                            const v = vv[j];
                            if ( qcls.has(v) === false ) {
                                classes.push(v); qcls.add(v);
                            }
                        }
                    }
                }
            }
            processed += n;
            if ( performance.now() >= deadline ) { break; }
        }
        const t1 = performance.now();
        surveyCost += t1 - t0;
        //console.info(`domSurveyor> Surveyed ${processed} nodes in ${(t1-t0).toFixed(2)} ms`);
        // Phase 2: Ask main process to lookup relevant cosmetic filters.
        if ( ids.length !== 0 || classes.length !== 0 ) {
            messaging.send('contentscript', {
                what: 'retrieveGenericCosmeticSelectors',
                hostname,
                ids,
                classes,
                exceptions: domFilterer.exceptions,
                cost: surveyCost,
            }).then(response => {
                surveyPhase3(response);
            });
        } else {
            surveyPhase3(null);
        }
        //console.timeEnd('dom surveyor/surveying');
    };

    const surveyTimer = new vAPI.SafeAnimationFrame(surveyPhase1);

    // This is to shutdown the surveyor if result of surveying keeps being
    // fruitless. This is useful on long-lived web page. I arbitrarily
    // picked 5 minutes before the surveyor is allowed to shutdown. I also
    // arbitrarily picked 256 misses before the surveyor is allowed to
    // shutdown.
    let canShutdownAfter = Date.now() + 300000,
        surveyingMissCount = 0;

    // Handle main process' response.

    const surveyPhase3 = function(response) {
        const result = response && response.result;
        let mustCommit = false;
        if ( result ) {
            let selectors = result.simple;
            if ( Array.isArray(selectors) && selectors.length !== 0 ) {
                domFilterer.addCSSRule(
                    selectors,
                    'display:none!important;',
                    { type: 'simple' }
                );
                mustCommit = true;
            }
            selectors = result.complex;
            if ( Array.isArray(selectors) && selectors.length !== 0 ) {
                domFilterer.addCSSRule(
                    selectors,
                    'display:none!important;',
                    { type: 'complex' }
                );
                mustCommit = true;
            }
            selectors = result.injected;
            if ( typeof selectors === 'string' && selectors.length !== 0 ) {
                //ADN tmp fix: hiding - local iframe without src
                const isSpecialLocalIframes = (location.href=="about:blank" || location.href=="") && (window.self !== window.top)
                domFilterer.addCSSRule(
                    selectors,
                    'display:none!important;',
                    { injected: isSpecialLocalIframes ? false : true }
                );
                mustCommit = true;
            }
            selectors = result.fake;
            if ( typeof selectors === 'string' && selectors.length !== 0 ) {
                domFilterer.addCSSRule(
                    selectors,
                    'height:0px!important;',
                    { injected: true }
                );
                mustCommit = true;
            }
            selectors = result.excepted;
            if ( Array.isArray(selectors) && selectors.length !== 0 ) {
                domFilterer.exceptCSSRules(selectors);
            }
            // ADN: ad check on new elements found
            let allSelectors = "";
            for(const key in result) {
              if(result[key] != "") allSelectors += (allSelectors == "" ? "" : ",") + result[key];
            }
            let nodes;
            if (allSelectors != "") {
              nodes = document.querySelectorAll(allSelectors);
              for ( const node of nodes ) {
                  vAPI.adCheck && vAPI.adCheck(node);
              }
            }

        }

        if ( pendingNodes.stopped === false ) {
            if ( pendingNodes.hasNodes() ) {
                surveyTimer.start(1);
            }
            if ( mustCommit ) {
                surveyingMissCount = 0;
                canShutdownAfter = Date.now() + 300000;
                return;
            }
            surveyingMissCount += 1;
            if ( surveyingMissCount < 256 || Date.now() < canShutdownAfter ) {
                return;
            }
        }

        //console.info('dom surveyor shutting down: too many misses');

        surveyTimer.clear();
        vAPI.domWatcher.removeListener(domWatcherInterface);
        vAPI.domSurveyor = null;
    };

    const domWatcherInterface = {
        onDOMCreated: function() {
            if (
                self.vAPI instanceof Object === false ||
                vAPI.domSurveyor instanceof Object === false ||
                vAPI.domFilterer instanceof Object === false
            ) {
                if ( self.vAPI instanceof Object ) {
                    if ( vAPI.domWatcher instanceof Object ) {
                        vAPI.domWatcher.removeListener(domWatcherInterface);
                    }
                    vAPI.domSurveyor = null;
                }
                return;
            }
            //console.time('dom surveyor/dom layout created');
            domFilterer = vAPI.domFilterer;
            pendingNodes.add(document.querySelectorAll('[id],[class]'));
            surveyTimer.start();
            //console.timeEnd('dom surveyor/dom layout created');
        },
        onDOMChanged: function(addedNodes) {
            if ( addedNodes.length === 0 ) { return; }
            //console.time('dom surveyor/dom layout changed');
            let i = addedNodes.length;
            while ( i-- ) {
                const node = addedNodes[i];
                pendingNodes.add([ node ]);
                if ( node.childElementCount === 0 ) { continue; }
                pendingNodes.add(node.querySelectorAll('[id],[class]'));
            }
            if ( pendingNodes.hasNodes() ) {
                surveyTimer.start(1);
            }
        }
    };

    const start = function(details) {
        if ( vAPI.domWatcher instanceof Object === false ) { return; }
        hostname = details.hostname;
        vAPI.domWatcher.addListener(domWatcherInterface);
    };

    vAPI.domSurveyor = { start };
}

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

// vAPI.bootstrap:
//   Bootstrapping allows all components of the content script
//   to be launched if/when needed.

    const bootstrapPhase2 = function() {
        // ADN
        if (vAPI.domFilterer) {
          vAPI.domFilterer.filterset.forEach(function(c){
            let nodes = document.querySelectorAll(c.selectors);
            for ( const node of nodes ) {
                vAPI.adCheck && vAPI.adCheck(node);
            }
          //  TODO:  proceduralFilters ?
          })
        }

        // This can happen on Firefox. For instance:
        // https://github.com/gorhill/uBlock/issues/1893
        if ( window.location === null ) { return; }
        if ( self.vAPI instanceof Object === false ) { return; }

        vAPI.messaging.send('contentscript', {
            what: 'shouldRenderNoscriptTags',
        });

        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.start();
        }

        // Element picker works only in top window for now.
        if (
            window !== window.top ||
            vAPI.domFilterer instanceof Object === false
        ) {
            return;
        }

        // To be used by element picker/zapper.
        vAPI.mouseClick = { x: -1, y: -1 };

        const onMouseClick = function(ev) {
            if ( ev.isTrusted === false ) { return; }
            vAPI.mouseClick.x = ev.clientX;
            vAPI.mouseClick.y = ev.clientY;

            // https://github.com/chrisaljoudi/uBlock/issues/1143
            //   Find a link under the mouse, to try to avoid confusing new tabs
            //   as nuisance popups.
            // https://github.com/uBlockOrigin/uBlock-issues/issues/777
            //   Mind that href may not be a string.
            const elem = ev.target.closest('a[href]');
            if ( elem === null || typeof elem.href !== 'string' ) { return; }
            vAPI.messaging.send('contentscript', {
                what: 'maybeGoodPopup',
                url: elem.href || '',
            });
        };

        document.addEventListener('mousedown', onMouseClick, true);

        // https://github.com/gorhill/uMatrix/issues/144
        vAPI.shutdown.add(function() {
            document.removeEventListener('mousedown', onMouseClick, true);
        });
    };


// https://github.com/uBlockOrigin/uBlock-issues/issues/403
//   If there was a spurious port disconnection -- in which case the
//   response is expressly set to `null`, rather than undefined or
//   an object -- let's stay around, we may be given the opportunity
//   to try bootstrapping again later.

    const bootstrapPhase1 = function(response) {
        if ( response instanceof Object === false ) { return; }

        vAPI.bootstrap = undefined;
        if (response && response.prefs) vAPI.prefs = response.prefs; // ADN
        // cosmetic filtering engine aka 'cfe'
        const cfeDetails = response && response.specificCosmeticFilters;
        if ( !cfeDetails || !cfeDetails.ready ) {
            vAPI.domWatcher = vAPI.domCollapser = vAPI.domFilterer =
            vAPI.domSurveyor = vAPI.domIsLoaded = null;
            return;
        }

        vAPI.domCollapser.start();

        if ( response.noCosmeticFiltering || response.prefs.hidingDisabled) { // ADN
            vAPI.domFilterer = null;
            vAPI.domSurveyor = null;
        } else {
            const domFilterer = vAPI.domFilterer = new vAPI.DOMFilterer();
            if ( response.noGenericCosmeticFiltering || cfeDetails.noDOMSurveying ) {
                vAPI.domSurveyor = null;
            }
            domFilterer.exceptions = cfeDetails.exceptionFilters;
            domFilterer.hideNodeAttr = cfeDetails.hideNodeAttr;
            domFilterer.hideNodeStyleSheetInjected =
                cfeDetails.hideNodeStyleSheetInjected === true;
            domFilterer.addCSSRule(
                cfeDetails.declarativeFilters,
                'display:none!important;'
            );
            domFilterer.addCSSRule(
                cfeDetails.highGenericHideSimple,
                'display:none!important;',
                { type: 'simple', lazy: true }
            );
            domFilterer.addCSSRule(
                cfeDetails.highGenericHideComplex,
                'display:none!important;',
                { type: 'complex', lazy: true }
            );
            domFilterer.addCSSRule(
                cfeDetails.injectedHideFilters,
                'display:none!important;',
                { injected: true }
            );
            domFilterer.addProceduralSelectors(cfeDetails.proceduralFilters);
            domFilterer.exceptCSSRules(cfeDetails.exceptedFilters);
        }

        if ( cfeDetails.networkFilters.length !== 0 && !vAPI.prefs.hidingDisabled) {
            vAPI.userStylesheet.add(
                cfeDetails.networkFilters + '\n{display:none!important;}');
        }
        vAPI.userStylesheet.apply();

        // Library of resources is located at:
        // https://github.com/gorhill/uBlock/blob/master/assets/ublock/resources.txt
        if ( response.scriptlets ) {
            vAPI.injectScriptlet(document, response.scriptlets);
            vAPI.injectedScripts = response.scriptlets;
        }

        if ( vAPI.domSurveyor instanceof Object ) {
            vAPI.domSurveyor.start(cfeDetails);
        }

        // https://github.com/chrisaljoudi/uBlock/issues/587
        // If no filters were found, maybe the script was injected before
        // uBlock's process was fully initialized. When this happens, pages
        // won't be cleaned right after browser launch.
        if (
            typeof document.readyState === 'string' &&
            document.readyState !== 'loading'
        ) {
            bootstrapPhase2();
        } else {
            document.addEventListener(
                'DOMContentLoaded',
                bootstrapPhase2,
                { once: true }
            );
        }
    };

    vAPI.bootstrap = function() {
        vAPI.messaging.send('contentscript', {
            what: 'retrieveContentScriptParameters',
            url: vAPI.effectiveSelf.location.href,
            isRootFrame: self === self.top,
            charset: document.characterSet,
        }).then(response => {
            bootstrapPhase1(response);
        });
    };
// })()

// This starts bootstrap process.
vAPI.bootstrap();

/******************************************************************************/
/******************************************************************************/
/******************************************************************************/

}
// <<<<<<<< end of HUGE-IF-BLOCK
