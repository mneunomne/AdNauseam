/*******************************************************************************

    AdNauseam - Fight back against advertising surveillance.
    Copyright (C) 2014-2021 Daniel C. Howe

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

import * as utils from './shared.js' 

if (!vAPI.parser) vAPI.adCheck();

QUnit.test('notifications', function (assert) {

 let notes = [utils.HidingDisabled, utils.ClickingDisabled, utils.BlockingDisabled, EasyList];
  assert.equal(utils.addNotification(notes, utils.HidingDisabled), false);
  assert.equal(notes.length,4);
  assert.equal(utils. removeNotification(notes, utils.EasyListNotification), true);
  assert.equal(notes.length,3);
  assert.equal(utils. removeNotification(notes, utils.EasyListNotification), false);
  assert.equal(notes.length,3);

  //let notes = [];
  assert.equal(utils.addNotification(notes, utils.ClickingDisabled), true);
  assert.equal(notes.length, 1);
  assert.equal(utils. removeNotification(notes, utils.BlockingDisabled), false);
  assert.equal(notes.length,1);
  assert.equal(utils. removeNotification(notes, utils.ClickingDisabled), true);
  assert.equal(notes.length,0);
  assert.equal(utils.addNotification(notes, utils.EasyListNotification), true);
  assert.equal(notes.length,1);
});

QUnit.test('parseDomain', function (assert) {

  assert.equal(utils.parseDomain("http://google.com"), "google.com");
  assert.equal(utils.parseDomain("https://google.com/page"), "google.com");
  assert.equal(utils.parseDomain("http://google.com/page.html"), "google.com");
  assert.equal(utils.parseDomain("https://play.google.com/page"), "play.google.com");
  assert.equal(utils.parseDomain("http://play.google.com/page.html"), "play.google.com");
  assert.equal(utils.parseDomain("https://google.com/page.html?key=val"), "google.com");
  assert.equal(utils.parseDomain("http://google.com/page.html?key=yahoo.com"), "google.com");
  assert.equal(utils.parseDomain("http://google.com?target=http://renwick.com/page"), "google.com");

  assert.equal(utils.parseDomain("http://google.com?target=http%3A%2F%2F15renwick%2Ecom%2F%3Futm_source%3DNYTimes%2Ecom%26utm_medium%3DBanner%26utm_campaign%3DHomepage%2520Module/"), "google.com");
  assert.equal(utils.parseDomain("http://play.google.com?target=http://renwick.com/page"), "play.google.com");
  assert.equal(utils.parseDomain("http://play.google.com?target=http%3A%2F%2F15renwick%2Ecom%2F%3Futm_source%3DNYTimes%2Ecom%26utm_medium%3DBanner%26utm_campaign%3DHomepage%2520Module/"), "play.google.com");
  assert.equal(utils.parseDomain("http://play.google.com?target=http://play.renwick.com/page"), "play.google.com");

  assert.equal(utils.parseDomain("http://google.com?target=http://15renwick.com/page", true), "15renwick.com");
  assert.equal(utils.parseDomain("http://google.com?target=http%3A%2F%2F15renwick%2Ecom%2F%3Futm_source%3DNYTimes%2Ecom%26utm_medium%3DBanner%26utm_campaign%3DHomepage%2520Module/", true), "15renwick.com");
  assert.equal(utils.parseDomain("http://play.google.com?target=http://15renwick.com/page", true), "15renwick.com");
  assert.equal(utils.parseDomain("http://play.google.com?target=http%3A%2F%2F15renwick%2Ecom%2F%3Futm_source%3DNYTimes%2Ecom%26utm_medium%3DBanner%26utm_campaign%3DHomepage%2520Module/", true), "15renwick.com");
  assert.equal(utils.parseDomain("http://play.google.com?target=http://play.15renwick.com/page", true), "play.15renwick.com");
});

QUnit.test('parseOnClick', function (assert) {

  const host = 'thepage.com', proto = "http:";
  let test = '<div onclick=\"window.open(\'http://google.com\',toolbar=no,location = no,status = no,menubar = no,scrollbars = yes,resizable = yes,width = SomeSize,height = SomeSize\');return false;\">link</div>';
  assert.equal(vAPI.adParser.parseOnClick(test, host, proto), 'http://google.com');

  test = '<div onclick=\"javascript:window.open(\'http://google.com\',toolbar=no,location = no,status = no,menubar = no,scrollbars = yes,resizable = yes,width = SomeSize,height = SomeSize\');return false;\">link</div>';
  assert.equal(vAPI.adParser.parseOnClick(test, host, proto), 'http://google.com');

  test = '<div onclick=\"javascript:window.open(\'http://google.com\')\">link</div>';
  assert.equal(vAPI.adParser.parseOnClick(test, host, proto), 'http://google.com');

  test = '<div onClick=\'window.open("http://google.com")\'>link</div>';
  assert.equal(vAPI.adParser.parseOnClick(test, host, proto), 'http://google.com');

  test = '<div onClick=\'window.open(http://google.com)\'>link</div>';
  assert.equal(vAPI.adParser.parseOnClick(test, host, proto), 'http://google.com');

  test = '<div onclick=\"aBunchofRandomJScode();\">link</div>';
  assert.equal(vAPI.adParser.parseOnClick(test, host, proto), undefined);

  test = '<div onClick=\'window.open("relative/link.html")\'>link</div>';
  assert.equal(vAPI.adParser.parseOnClick(test, host, proto), 'http://thepage.com/relative/link.html');

  test = '<div onClick=\'window.open("relative/link.html")\'>link</div>';
  assert.equal(vAPI.adParser.parseOnClick(test, host, 'https:'), 'https://thepage.com/relative/link.html');

  test = 'onclick="EBG.ads[&quot;39178788_6277666087953531&quot;].onImageClick(&quot;39178788_6277666087953531&quot;, false,&quot;ebDefaultImg_39178788_6277666087953531&quot;, &quot;https://www.rolex.com/?cmpid=dw_TheRolexWay_201604843&quot;, &quot;&quot;, &quot;&quot;)">';
  assert.equal(vAPI.adParser.parseOnClick(test, 'nytimes.com'), 'https://www.rolex.com/?cmpid=dw_TheRolexWay_201604843');
});

QUnit.test('isValidDomain', function (assert) {

  assert.equal(utils.isValidDomain('example.com'), true);
  assert.equal(utils.isValidDomain('foo.example.com'), true);
  assert.equal(utils.isValidDomain('bar.foo.example.com'), true);
  assert.equal(utils.isValidDomain('exa-mple.co.uk'), true);

  assert.equal(utils.isValidDomain('exa_mple.com'), false);
  assert.equal(utils.isValidDomain('example'), false);
  assert.equal(utils.isValidDomain({}), false);
  assert.equal(utils.isValidDomain(function () {}), false);
  assert.equal(utils.isValidDomain('ex*mple.com'), false);
  assert.equal(utils.isValidDomain('@#$@#$%fd'), false);

  assert.equal(utils.isValidDomain(''), false);
  assert.equal(utils.isValidDomain('https'), false);
  assert.equal(utils.isValidDomain('https:'), false);
  assert.equal(utils.isValidDomain('Dont_Tell_Anyone_You_Play_This_Game'), false);
  assert.equal(utils.isValidDomain('https://Dont_Tell_Anyone_You_Play_This_Game'), false);
  assert.equal(utils.isValidDomain('https://Get_Rid_Of_20_Lbs_Of_Belly_Fat_In_Just_1_Month'), false);
  assert.equal(utils.isValidDomain('https://This_Addictive_Game_Will_Keep_You_Up_All_Night'), false);
  assert.equal(utils.isValidDomain('https://leagueofangelsii/The_Hottest_New_MMO_Game_You_Need_To_Start_Playing_Now'), false);
  assert.equal(utils.isValidDomain('https://This_Fascinating_Game_Amazes_94_Of_The_Players._Wanna_Try_It'), false);
});

QUnit.test('parseAndValidateDomain', function (assert) {

  assert.equal(utils.isValidDomain(utils.parseDomain('https://example.com')), true);
  assert.equal(utils.isValidDomain(utils.parseDomain('https://foo.example.com')), true);
  assert.equal(utils.isValidDomain(utils.parseDomain('https://bar.foo.example.com')), true);
  assert.equal(utils.isValidDomain(utils.parseDomain('https://exa-mple.co.uk')), true);

  assert.equal(utils.isValidDomain(utils.parseDomain('exa_mple.com')), false);
  assert.equal(utils.isValidDomain(utils.parseDomain('example')), false);
  assert.equal(utils.isValidDomain(utils.parseDomain('ex*mple.com')), false);

  assert.equal(utils.isValidDomain(utils.parseDomain('https://Dont_Tell_Anyone_You_Play_This_Game')), false);
  assert.equal(utils.isValidDomain(utils.parseDomain('https://Get_Rid_Of_20_Lbs_Of_Belly_Fat_In_Just_1_Month')), false);
  assert.equal(utils.isValidDomain(utils.parseDomain('https://This_Addictive_Game_Will_Keep_You_Up_All_Night')), false);
  assert.equal(utils.isValidDomain(utils.parseDomain('https://leagueofangelsii/The_Hottest_New_MMO_Game_You_Need_To_Start_Playing_Now')), false);
  assert.equal(utils.isValidDomain(utils.parseDomain('https://This_Fascinating_Game_Amazes_94_Of_The_Players._Wanna_Try_It')), false);
});
