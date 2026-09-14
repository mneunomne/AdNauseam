const parserTests = [ {
    name: 'Parser bookkeeping produces no DOM attribute mutations',
    run: async (win, doc) => {
        const node = doc.createElement('div');
        doc.body.append(node);
        const observer = new win.MutationObserver(() => {});
        observer.observe(node, { attributes: true, subtree: true });
        try {
            win.vAPI.adCheck(node);
            assert(observer.takeRecords().length === 0, 'Parser wrote to the DOM');
            assert(!node.hasAttribute('process-adn'), 'Parser exposed its timestamp to the page');
        } finally {
            observer.disconnect();
        }
    },
},{
    name: 'Cooldown and explicit invalidation still allow later rescans',
    run: async (win, doc) => {
        const node = doc.createElement('div');
        let scans = 0;
        let now = 0;
        const dateNow = win.Date.now;
        win.Date.now = () => now;
        win.vAPI.textAdParser.process = () => { scans++; };
        try {
            win.vAPI.adCheck(node);
            win.vAPI.adCheck(node);
            assert(scans === 1, 'Same node scanned twice inside the cooldown');
            now = 3000;
            win.vAPI.adCheck(node);
            assert(scans === 2, 'Node was not rescanned after cooldown');
            assert(win.vAPI.adParser.resetProcessed(node), 'Missing bookkeeping for scanned node');
            win.vAPI.adCheck(node);
            assert(scans === 3, 'Explicit invalidation did not allow immediate rescan');
        } finally {
            win.Date.now = dateNow;
        }
    },
},{
    name: 'An editor reacting to attribute changes is not driven into a rebuild loop',
    run: async (win, doc) => {
        const editor = doc.createElement('div');
        editor.contentEditable = 'true';
        doc.body.append(editor);
        const node = doc.createElement('span');
        node.textContent = 'Editor text';
        let rebuilds = 0;
        const observer = new win.MutationObserver(records => {
            if ( !records.some(record => record.type === 'attributes') ) { return; }
            rebuilds++;
            if ( rebuilds >= 12 ) { observer.disconnect(); return; }
            const replacement = doc.createElement('span');
            replacement.textContent = 'Editor text';
            editor.replaceChildren(replacement);
        });
        observer.observe(editor, { attributes: true, subtree: true });
        try {
            editor.append(node);
            win.vAPI.adCheck(node);
            await wait(300);
            assert(rebuilds === 0, `Parser triggered ${rebuilds} editor rebuilds`);
            assert(editor.firstChild === node, 'Editor replaced the original text node');
        } finally {
            observer.disconnect();
        }
    },
},{
    name: 'Real domCollapser invalidates the nearest processed ancestor',
    run: async (win, doc) => {
        const outer = doc.createElement('div');
        const container = doc.createElement('div');
        outer.append(container);
        doc.body.append(outer);
        await wait(100);
        const scanned = [];
        win.vAPI.textAdParser.process = node => { scanned.push(node); };
        win.vAPI.adCheck(container);
        scanned.length = 0;
        container.append(doc.createElement('span'));
        await until(() => scanned.includes(container));
        assert(!scanned.includes(outer), 'Invalidation climbed past the nearest processed ancestor');
        assert(doc.querySelector('[process-adn]') === null, 'Invalidation still uses DOM attributes');
    },
},{
    name: 'Direct image parsing collects on first visit and deduplicates repeats',
    run: async (win, doc) => {
        const { image, link } = await adImage(win, doc);
        doc.body.append(link);
        win.vAPI.adCheck(image);
        win.vAPI.adCheck(image);
        assert(win.testAds.length === 1, `Expected one ad, got ${win.testAds.length}`);
        assert(win.testAds[0].targetUrl === link.href, 'Wrong click target');
    },
},{
    name: 'New image ads inside an already scanned container are still collected',
    run: async (win, doc) => {
        const container = doc.createElement('div');
        doc.body.append(container);
        win.vAPI.adCheck(container);
        await wait(100);
        const { image, link } = await adImage(win, doc);
        container.append(link);
        await until(() => win.testAds.length > 0);
        assert(win.testAds[0].contentData.src === image.src, 'Dynamic image was not collected');
    },
},{
    name: 'Text filter referrer is parsed once across many added nodes',
    run: async (win, doc) => {
        Object.defineProperty(doc, 'referrer', { configurable: true, value: 'https://editor.example/document/' });
        const NativeURL = win.URL;
        let urlParses = 0;
        win.URL = class extends NativeURL {
            constructor(...args) { super(...args); urlParses++; }
        };
        const node = doc.createElement('div');
        for ( let i = 0; i < 1000; i++ ) { win.vAPI.textAdParser.process(node); }
        assert(urlParses === 1, `Expected one URL parse, got ${urlParses}`);
    },
},{
    name: 'Missing or malformed referrers do not break text ad parsing',
    run: async (win, doc) => {
        for ( const referrer of ['', 'about:blank', 'https://example.com/%ZZ', 'https://[/'] ) {
            Object.defineProperty(doc, 'referrer', { configurable: true, value: referrer });
            win.vAPI.textAdParser.process(doc.createElement('div'));
        }
    },
},{
    name: 'Cached text filters still collect ads on supported domains',
    run: async (win, doc) => {
        const node = doc.createElement('div');
        node.className = 'ad';
        node.innerHTML = '<div class="title"><a href="https://ads.example/text"><span>Example</span></a></div>' +
            '<div class="desc"><span>Description</span></div><div class="durl"><span>ads.example</span></div>';
        doc.body.append(node);
        Object.defineProperty(doc, 'referrer', { configurable: true, value: 'https://example.com/' });
        win.vAPI.textAdParser.process(node);
        assert(win.testAds.length === 0, 'Text filters ran on an unsupported domain');
        Object.defineProperty(doc, 'referrer', { configurable: true, value: 'https://www.aol.com/' });
        win.vAPI.textAdParser.process(node);
        assert(win.testAds.some(ad => ad.contentType === 'text' && ad.targetUrl === 'https://ads.example/text'),
            'Text ad was lost after caching domain filters');
    },
},{
    name: 'Whitelisted frames do not start ad scanning',
    run: async (win, doc) => {
        let scans = 0;
        win.vAPI.adCheck = () => { scans++; };
        const { link } = await adImage(win, doc);
        doc.body.append(link);
        await wait(100);
        assert(scans === 0 && win.testAds.length === 0, 'Whitelisted iframe was scanned');
    },
    whitelisted: true,
},{
    name: 'Stopping content scripts disconnects iframe scanning',
    run: async (win, doc) => {
        let scans = 0;
        win.vAPI.adCheck = () => { scans++; };
        win.vAPI.shutdown.exec();
        doc.body.append(doc.createElement('div'));
        await wait(100);
        assert(scans === 0, 'Iframe observer remained active after shutdown');
    },
} ];

const assert = (condition, message) => {
    if ( !condition ) { throw new Error(message); }
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => {
    for ( let i = 0; i < 80; i++ ) {
        if ( predicate() ) { return; }
        await wait(25);
    }
    throw new Error('Condition not reached within 2 seconds');
};

function setupFrame() {
    window.testAds = [];
    window.testErrors = [];
    window.addEventListener('error', event => window.testErrors.push(event.message));
    window.addEventListener('unhandledrejection', event => {
        window.testErrors.push(String(event.reason));
    });
    window.chrome = { extension: { inIncognitoContext: false } };
    window.vAPI = {
        prefs: { logEvents: false, textAdsDisabled: false },
        setTimeout: window.setTimeout.bind(window),
        randomToken: () => `adn${Math.random().toString(36).slice(2)}`,
        shutdown: {
            jobs: new Set(),
            add(job) { this.jobs.add(job); },
            remove(job) { this.jobs.delete(job); },
            exec() {
                for ( const job of [...this.jobs] ) { job(); }
                this.jobs.clear();
            },
        },
        messaging: {
            async send(channel, request) {
                switch ( request.what ) {
                case 'retrieveContentScriptParameters':
                    if ( window.testWhitelisted ) { return; }
                    return {
                        prefs: vAPI.prefs,
                        noGenericCosmeticFiltering: true,
                        noSpecificCosmeticFiltering: true,
                        specificCosmeticFilters: { ready: true },
                    };
                case 'registerAd':
                    window.testAds.push(request.ad);
                    break;
                case 'getCollapsibleBlockedRequests':
                    return { id: request.id, hash: 'empty', blockedResources: [] };
                }
            },
        },
    };
}

async function fixture(run, { whitelisted = false } = {}) {
    const frame = document.createElement('iframe');
    frame.title = 'Parser test fixture';
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    frame.srcdoc = `<!doctype html><body>
        <script>window.testWhitelisted = ${whitelisted}; (${setupFrame.toString()})();</script>
        <script src="../src/js/contentscript.js"></script>
        <script src="../src/js/adn/textads.js"></script>
        <script src="../src/js/adn/parser.js"></script>`;
    document.querySelector('#fixture').append(frame);
    try {
        await loaded;
        const win = frame.contentWindow;
        await until(() => win.vAPI.adParser !== undefined);
        await run(win, win.document);
        assert(win.testErrors.length === 0, win.testErrors.join('\n'));
    } finally {
        frame.contentWindow.vAPI?.shutdown.exec();
        frame.remove();
    }
}

async function adImage(win, doc) {
    const image = new win.Image();
    image.alt = 'Example ad';
    image.width = image.height = 100;
    image.src = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'
    );
    await image.decode();
    const link = doc.createElement('a');
    link.href = 'https://ads.example/landing';
    link.append(image);
    return { image, link };
}

const report = [];
const summary = document.querySelector('#summary');
const main = document.querySelector('main');
for ( const { name, run, whitelisted } of parserTests ) {
    const fragment = document.querySelector('#test-result').content.cloneNode(true);
    const div = fragment.children[0];
    const result = div.children[1];
    div.children[0].textContent = name;
    result.textContent = 'Running…';
    main.append(fragment);
    summary.textContent = `Running test ${report.length + 1}/${parserTests.length}…`;
    try {
        await fixture(run, { whitelisted });
        report.push({ name, ok: true });
        result.textContent = 'PASS';
        result.classList.add('pass');
    } catch (error) {
        const details = `${error.message}\n${error.stack || ''}`;
        report.push({ name, ok: false, error: details });
        result.textContent = `FAIL\n${details}`;
        result.classList.add('fail');
    }
}
const passed = report.filter(result => result.ok).length;
summary.textContent = `${passed}/${parserTests.length} passed`;
summary.classList.add(passed === parserTests.length ? 'pass' : 'fail');
