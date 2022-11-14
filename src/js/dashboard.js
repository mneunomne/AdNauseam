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

/* global uDom */

'use strict';

import * as utils from './adn/shared.js'

/******************************************************************************/

const resizeFrame = function() {
    const navRect = document.getElementById('dashboard-nav')
                            .getBoundingClientRect();
    const viewRect = document.documentElement.getBoundingClientRect();
    const notiRect = document.getElementById('notifications').offsetHeight; //AdNauseam
    document.getElementById('iframe').style.setProperty(
        'height',
        (viewRect.height - navRect.height - notiRect) + 'px' //AdNauseam
    );
};

const discardUnsavedData = function(synchronous = false) {
    const paneFrame = document.getElementById('iframe');
    const paneWindow = paneFrame.contentWindow;
    if (
        typeof paneWindow.hasUnsavedData !== 'function' ||
        paneWindow.hasUnsavedData() === false
    ) {
        return true;
    }

    if ( synchronous ) {
        return false;
    }

    return new Promise(resolve => {
        const modal = uDom.nodeFromId('unsavedWarning');
        modal.classList.add('on');
        modal.focus();

        const onDone = status => {
            modal.classList.remove('on');
            document.removeEventListener('click', onClick, true);
            resolve(status);
        };

        const onClick = ev => {
            const target = ev.target;
            if ( target.matches('[data-i18n="dashboardUnsavedWarningStay"]') ) {
                return onDone(false);
            }
            if ( target.matches('[data-i18n="dashboardUnsavedWarningIgnore"]') ) {
                return onDone(true);
            }
            if ( modal.querySelector('[data-i18n="dashboardUnsavedWarning"]').contains(target) ) {
                return;
            }
            onDone(false);
        };

        document.addEventListener('click', onClick, true);
    });
};

const loadDashboardPanel = function(pane, first) {
    const tabButton = uDom.nodeFromSelector(`[data-pane="${pane}"]`);
    if ( tabButton === null || tabButton.classList.contains('selected') ) {
        return;
    }
    const loadPane = ( ) => {
        self.location.replace(`#${pane}`);
        uDom('.tabButton.selected').toggleClass('selected', false);
        tabButton.classList.add('selected');
        tabButton.scrollIntoView();
        uDom.nodeFromId('iframe').contentWindow.location.replace(pane);
        if ( pane !== 'no-dashboard.html' ) {
            vAPI.localStorage.setItem('dashboardLastVisitedPane', pane);
        }
    };
    if ( first ) {
        return loadPane();
    }
    const r = discardUnsavedData();
    if ( r === false ) { return; }
    if ( r === true ) {
        return loadPane();
    }
    r.then(status => {
        if ( status === false ) { return; }
        loadPane();
    });
};

const onTabClickHandler = function(ev) {
    loadDashboardPanel(ev.target.getAttribute('data-pane'));
};

if ( self.location.hash.slice(1) === 'no-dashboard.html' ) {
    document.body.classList.add('noDashboard');
}

/// ADN notification to appear on dashboard
vAPI.broadcastListener.add(request => {
    switch (request.what) {
        case 'notifications':
            utils.renderNotifications(request.notifications, "dashboard");
            resizeFrame();
            break;
        // ADN when "disable notifications" option is changed, hide or show notifications
        case 'hideNotifications':
            uDom('#notifications').addClass("hide");
            break;
        case 'showNotifications':
           uDom('#notifications').removeClass("hide");
            break;
    }
  });

(async ( ) => {
    const results = await Promise.all([
        // https://github.com/uBlockOrigin/uBlock-issues/issues/106
        vAPI.messaging.send('dashboard', { what: 'dashboardConfig' }),
        vAPI.localStorage.getItemAsync('dashboardLastVisitedPane'),
    ]);

    {
        const details = results[0] || {};
        document.body.classList.toggle(
            'canUpdateShortcuts',
            details.canUpdateShortcuts === true
        );
        if ( details.noDashboard ) {
            self.location.hash = '#no-dashboard.html';
            document.body.classList.add('noDashboard');
        } else if ( self.location.hash === '#no-dashboard.html' ) {
            self.location.hash = '';
        }
    }

    {
        let pane = results[1] || null;
        if ( self.location.hash !== '' ) {
            pane = self.location.hash.slice(1) || null;
        }
        loadDashboardPanel(pane !== null ? pane : 'options.html', true);

        uDom('.tabButton').on('click', onTabClickHandler);

        // https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
        window.addEventListener('beforeunload', ( ) => {
            if ( discardUnsavedData(true) ) { return; }
            event.preventDefault();
            event.returnValue = '';
        });
    }
})();

vAPI.messaging.send(
    'adnauseam', {
        what: 'verifyAdBlockers'
    }).then(n => {
      vAPI.messaging.send(
          'adnauseam', {
              what: 'getNotifications'
          }).then(data => {
          if (data.notifications && data.notifications.length)
              utils.renderNotifications(data.notifications, 'dashboard');
              resizeFrame();
        })
});

// disable warnings #1910
vAPI.messaging.send(
    'adnauseam', {
      what: 'getWarningDisabled'
    }
  ).then(isDisabled => {
    if (isDisabled) {
      uDom("#notifications").addClass('hide');
    } else {
      uDom("#notifications").removeClass('hide');
    }
    // adjustHeight();
})
