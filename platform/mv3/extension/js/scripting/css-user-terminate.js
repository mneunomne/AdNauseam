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

(function uBOL_cssUserTerminate() {

/******************************************************************************/

// adn: no layout space, but a 1px box so lazy-loaded ads still render and get collected
const adnHideStyle = 'position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;'; // adn

const plainSelectors = self.customFilters?.plainSelectors;
if ( plainSelectors ) {
    chrome.runtime.sendMessage({
        what: 'removeCSS',
        css: `${plainSelectors.join(',\n')}{${adnHideStyle}}`, // adn
    }).catch(( ) => {
    });
}

if ( self.customProceduralFiltererAPI instanceof Object ) {
    self.customProceduralFiltererAPI.reset();
}

self.customFilters = undefined;

/******************************************************************************/

})();

void 0;
