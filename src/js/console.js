/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2019-present Raymond Hill

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

function adnlogSet(state = false) {
    if ( state ) {
        if ( adnlog.process instanceof Function ) {
            adnlog.process();
        }
        adnlog = adnlogDo;
    } else {
        adnlog = adnlogIgnore;
    }
}

function adnlogDo(...args) {
    console.info('[ADN]', ...args);
}

function adnlogIgnore() {
}

let adnlog = (( ) => {
    const pending = [];
    const store = function(...args) {
        pending.push(args);
    };
    store.process = function() {
        for ( const args of pending ) {
            adnlogDo(...args);
        }
    };
    return store;
})();

/******************************************************************************/

export { adnlog, adnlogSet };
