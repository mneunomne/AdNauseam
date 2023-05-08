
'use strict';

import { dom } from './dom.js';

(async ( ) => {

    vAPI.messaging.send('dashboard', { what: 'getAppData' }, appData => {
        dom.text('#aboutNameVer', appData.name + ' v' + appData.version);
    });

    // document.querySelector(
    //     '[href="logger-ui.html"]'
    // ).addEventListener(
    //     'click',
    //     self.uBlockDashboard.openOrSelectPage
    // );

    const appData = await vAPI.messaging.send('dashboard', {
        what: 'getAppData',
    });

    dom.text('#aboutNameVer #uBlock', appData.name);
    dom.text('#aboutNameVer #builtOnVersion', 'v' + appData.version);

    if ( appData.canBenchmark !== true ) { return; }

    document.getElementById('dev').classList.add('enabled');

    document.getElementById('sfneBenchmark').addEventListener('click', ev => {
        const button = ev.target;
        button.setAttribute('disabled', '');
        vAPI.messaging.send('dashboard', {
            what: 'sfneBenchmark',
        }).then(result => {
            document.getElementById('sfneBenchmarkResult').textContent = result;
            button.removeAttribute('disabled');
        });
    });

    dom.text('#aboutNameVer', appData.name + ' v' + appData.version);
})();
