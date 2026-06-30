/*******************************************************************************
    AdNauseam MV3 - Dashboard options

    Wires AdNauseam-specific settings on the dashboard Settings pane to the
    service worker via getAdnSettings/setAdnSettings.
*******************************************************************************/

'use strict';

// Hiding style: opacity:0 (default, keeps ads rendered/collectable) vs display:none
const hidingStyle = document.querySelector('#adnHidingStyle input[type="checkbox"]');

if (hidingStyle) {
  chrome.runtime.sendMessage({ what: 'getAdnSettings' }, settings => {
    hidingStyle.checked = !!settings && settings.hidingStyle === 'display';
  });

  hidingStyle.addEventListener('change', () => {
    chrome.runtime.sendMessage({
      what: 'setAdnSettings',
      settings: { hidingStyle: hidingStyle.checked ? 'display' : 'opacity' },
    });
  });
}
