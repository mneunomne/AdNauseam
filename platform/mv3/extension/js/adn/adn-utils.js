/*******************************************************************************

    AdNauseam - Fight back against advertising surveillance.
    Copyright (C) 2014-2024 Daniel C. Howe

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

    Home: https://github.com/dhowe/AdNauseam
*/

'use strict';

import YaMD5 from '../../lib/yamd5.js';

// targets on these domains are never internal
export const internalLinkDomainsDefault = [
  'google.com', 'asiaxpat.com', 'nytimes.com',
  'columbiagreenemedia.com', '163.com', 'sohu.com', 'zol.com.cn', 'baidu.com',
  'yahoo.com', 'facebook.com', 'youtube.com', 'flashback.org',
  'amazon.ae', 'amazon.ca', 'amazon.cn', 'amazon.co.jp', 'amazon.co.uk',
  'amazon.com', 'amazon.com.au', 'amazon.com.be', 'amazon.com.br',
  'amazon.com.mx', 'amazon.com.tr', 'amazon.de', 'amazon.eg', 'amazon.es',
  'amazon.fr', 'amazon.in', 'amazon.it', 'amazon.nl', 'amazon.pl',
  'amazon.sa', 'amazon.se', 'amazon.sg',
];

export const type = function (obj) {
  return ({}).toString.call(obj).match(/\s([a-zA-Z]+)/)[1].toLowerCase();
};

export const arrayRemove = function (arr, obj) {
  const i = arr.indexOf(obj);
  if (i !== -1) {
    arr.splice(i, 1);
    return true;
  }
  return false;
};

export const trimChar = function (s, chr) {
  while (s.endsWith(chr)) {
    s = s.substring(0, s.length - chr.length);
  }
  return s;
};

export const byField = function (prop) {
  let sortOrder = 1;
  if (prop[0] === '-') {
    sortOrder = -1;
    prop = prop.substr(1);
  }
  return function (a, b) {
    const result = (a[prop] < b[prop]) ? -1 : (a[prop] > b[prop]) ? 1 : 0;
    return result * sortOrder;
  };
};

/************************ Hashing *****************************/

// DO NOT MODIFY
export const computeHash = function (ad) {
  if (!ad) return;

  if (!ad.contentData || !ad.pageUrl) {
    console.error('Invalid Ad: no contentData || pageUrl', ad);
    return;
  }

  let hash = ad.pageDomain || ad.pageUrl;

  const keys = Object.keys(ad.contentData).sort();

  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== 'width' && keys[i] !== 'height')
      hash += '::' + ad.contentData[keys[i]];
  }

  return YaMD5.hashStr(hash);
};

/************************ URL utils *****************************/

export const parseHostname = function (url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return undefined;
  }
};

export const parseDomain = function (url, useLast) {
  try {
    const domains = decodeURIComponent(url).match(/https?:\/\/[^?\/]+/g);
    return (domains && domains.length > 0)
      ? new URL(useLast ? domains[domains.length - 1] : domains[0]).hostname
      : undefined;
  } catch (e) {
    return undefined;
  }
};

export const isValidDomain = function (v) {
  const re = /^(?!:\/\/)([a-zA-Z0-9-]+\.){0,5}[a-zA-Z0-9-][a-zA-Z0-9-]+\.[a-zA-Z]{2,64}?$/gi;
  return v ? re.test(v) : false;
};

/*
 * Start with resolvedTargetUrl if available, else use targetUrl
 * Then extract the last domain from the (possibly complex) url
 */
export const targetDomain = function (ad) {
  const dom = parseDomain(ad.resolvedTargetUrl || ad.targetUrl, true);
  if (!dom) console.warn('Unable to parse domain: ' + ad.targetUrl);
  return dom;
};

export { YaMD5 };
