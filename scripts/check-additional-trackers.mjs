import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const readTracker = id => JSON.parse(fs.readFileSync(new URL(`../config/trackers/${id}.json`, import.meta.url), 'utf8'));
const bwtorrents = readTracker('bwtorrents');
const uniotaku = readTracker('uniotaku');
const hdspace = readTracker('hdspace');
const yusceneRaw = readTracker('yuscene');
const torrenterosRaw = readTracker('torrenteros');
const originalCwd = process.cwd();
const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'tracker-dashboard-additional-'));

try {
  // Import only after isolating cwd, so the production extractor cannot open a real account database.
  process.chdir(temp);
  const { extractExtraFieldResponse } = await import('../dist/fetcher.js');
  const { applyEnginePreset } = await import('../dist/trackerTemplates.js');
  const extract = (tracker, html) => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
    field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
  ]));
  const empty = tracker => Object.fromEntries(Object.keys(tracker.fetch.fields).map(field => [field, undefined]));

  // Account-header structure verified from sanitized markup; every account value here is synthetic.
  const bwHeader = ({ uploaded = '12.75 GB', downloaded = '2.50 GB', ratio = '5.100',
    seeding = '18', leeching = '2', bonus = '9,876.50' } = {}) => `
    <div id="left-sts-aeon"><a href="userdetails.php?id=734">synthetic-member</a>&nbsp;
    <a class="fa fa-arrow-up grn" title="Uploaded"></a><a title="Uploaded"><font color="green"> ${uploaded}</font></a>&nbsp;
    <a class="fa fa-arrow-down red" title="Downloaded"></a><a title="Downloaded"><font color="red"> ${downloaded}</font></a>&nbsp;
    <a class="fa fa-battery-three-quarters" title="Ratio"></a><a title="Ratio"><font color="caeeda"> ${ratio}</font></a>&nbsp;
    <img alt="Torrents seeding" title="Torrents seeding">&nbsp;<font class="statusdetails"><span class="smallfont">${seeding}</span></font>&nbsp;
    <img alt="Torrents leeching" title="Torrents leeching">&nbsp;<font class="statusdetails"><span class="smallfont">${leeching}</span></font>&nbsp;
    <a href="mybonus.php" class="fa fa-gift" title="Bonus Points"></a><a title="Bonus Points" href="mybonus.php"><font color="orange"> ${bonus}</font>&nbsp;</a></div>`;
  const bwExpected = {
    uploadedBytes: 12_750_000_000, downloadedBytes: 2_500_000_000, ratio: 5.1,
    seeding: 18, leeching: 2, seedBonus: '9,876.50',
  };
  for (const html of [bwHeader(), bwHeader().replaceAll('"', "'")]) {
    assert.deepEqual(extract(bwtorrents, html), bwExpected);
  }
  assert.deepEqual(extract(bwtorrents, bwHeader({ uploaded: '0 B', downloaded: '0.00 GB', ratio: '0.000', seeding: '0', leeching: '0', bonus: '0.00' })), {
    uploadedBytes: 0, downloadedBytes: 0, ratio: 0, seeding: 0, leeching: 0, seedBonus: '0.00',
  });
  assert.equal(extract(bwtorrents, bwHeader({ uploaded: '1.5&nbsp;GiB' })).uploadedBytes, 1.5 * 1024 ** 3);
  assert.equal(extract(bwtorrents, bwHeader({ downloaded: '2&#160;MiB' })).downloadedBytes, 2 * 1024 ** 2);
  assert.equal(extract(bwtorrents, bwHeader({ uploaded: '1,234.50 GB' })).uploadedBytes, 1_234_500_000_000);
  assert.equal(extract(bwtorrents, bwHeader({ bonus: '12 345,67' })).seedBonus, '12 345,67');
  assert.equal(extract(bwtorrents, bwHeader({ uploaded: '' })).uploadedBytes, undefined, 'Upload must not capture download');
  assert.equal(extract(bwtorrents, bwHeader({ ratio: '---' })).ratio, undefined);
  const unrelatedBw = bwHeader().replace('left-sts-aeon', 'torrent-list-statistics');
  const blankBw = bwHeader({ uploaded: '', downloaded: '', ratio: '', seeding: '', leeching: '', bonus: '' });
  assert.deepEqual(extract(bwtorrents, unrelatedBw), empty(bwtorrents));
  assert.deepEqual(extract(bwtorrents, blankBw + unrelatedBw), empty(bwtorrents), 'Missing header values must not capture later page counters');

  const uniHeader = ({ uploaded = '7.50 GB', downloaded = '2.50 GB', ratio = '3.000', bonus = '321.50' } = {}) => `
    <div class="infotracker"><small>Ratio: ${ratio}<br> Otabills: ${bonus}</small></div>
    <div class="downupsidebar">
      <span class="text-grey">Download: </span><span class="text-red">${downloaded}</span><br>
      <span class="text-grey">Upload: </span><span class="text-green-lighter">${uploaded}</span>
    </div>`;
  const uniExpected = { uploadedBytes: 7_500_000_000, downloadedBytes: 2_500_000_000, ratio: 3, seedBonus: '321.50' };
  for (const html of [uniHeader(), uniHeader().replaceAll('"', "'")]) {
    assert.deepEqual(extract(uniotaku, html), uniExpected);
  }
  assert.deepEqual(extract(uniotaku, uniHeader({ uploaded: '0.00 B', downloaded: '0 B', ratio: '---', bonus: '0.00' })), {
    uploadedBytes: 0, downloadedBytes: 0, ratio: undefined, seedBonus: '0.00',
  });
  assert.equal(extract(uniotaku, uniHeader({ ratio: '0.000' })).ratio, 0);
  assert.equal(extract(uniotaku, uniHeader({ downloaded: '1.25&nbsp;GiB' })).downloadedBytes, 1.25 * 1024 ** 3);
  assert.equal(extract(uniotaku, uniHeader({ uploaded: '1,234.50 MB' })).uploadedBytes, 1_234_500_000);
  assert.equal(extract(uniotaku, uniHeader({ bonus: '12 345,67' })).seedBonus, '12 345,67');
  assert.equal(extract(uniotaku, uniHeader({ downloaded: '' })).downloadedBytes, undefined, 'Download must not capture upload');
  const unrelatedUni = uniHeader().replace('infotracker', 'global-ratio').replace('downupsidebar', 'torrent-statistics');
  const blankUni = uniHeader({ uploaded: '', downloaded: '', ratio: '---', bonus: '' });
  assert.deepEqual(extract(uniotaku, unrelatedUni), empty(uniotaku));
  assert.deepEqual(extract(uniotaku, blankUni + unrelatedUni), empty(uniotaku), 'Missing sidebar values must not cross into other sections');
  assert.deepEqual(extract(uniotaku, uniHeader({ uploaded: '25', downloaded: '12', ratio: '---', bonus: '' })), empty(uniotaku), 'Traffic totals require byte units');

  // Public login forms and Jackett adapters confirm the form endpoints and input names; neither has a CAPTCHA.
  const logins = [
    [bwtorrents, '<form action="takelogin.php" method="post"><input name="username"><input type="password" name="password"></form>', unrelatedBw],
    [uniotaku, '<form action="account-login.php" method="POST"><input name="username"><input type="password" name="password"><input type="checkbox" name="manter" value="1"></form>', unrelatedUni],
  ];
  for (const [tracker, login, unrelated] of logins) {
    assert.equal(tracker.login.cookieOnly, undefined);
    assert.equal(tracker.enabled, false);
    for (const html of [login, login.replaceAll('"', "'")]) {
      assert.ok(tracker.login.failurePatterns.some(pattern => html.includes(pattern)));
      assert.deepEqual(extract(tracker, html + unrelated), empty(tracker));
    }
  }
  assert.equal(bwtorrents.login.url, 'login.php');
  assert.equal(bwtorrents.login.postUrl, 'takelogin.php');
  assert.deepEqual(bwtorrents.login.body, { username: '{{username}}', password: '{{password}}' });
  assert.equal(uniotaku.login.url, '/');
  assert.equal(uniotaku.login.postUrl, 'account-login.php');
  assert.deepEqual(uniotaku.login.body, { username: '{{username}}', password: '{{password}}', manter: '1' });
  // HD-Space's verified xbtit account cells. Values and account ID are synthetic.
  // xbtit makesize divides by 1024 while printing KB/GB, so bytesBinary is required.
  const hdHeader = ({ uploaded = '12.50 GB', downloaded = '2.50 GB', ratio = '5.00',
    bonus = '1,234.50', rank = 'Fixture Member', unread } = {}) => `<table><tr>
    <td style="text-align:center;" align="center">Rank: ${rank}</td>
    <td class="green" align="center"> UP: ${uploaded}</td>
    <td class="red" align="center"> DL: ${downloaded}</td>
    <td class="yellow" align="center"> Ratio: ${ratio}</td>
    <td class="green" align="center"><a href="index.php?page=modules&amp;module=seedbonus">Bonus: ${bonus}</a></td>
    <td style="text-align:center;" align="center"><a href="index.php?page=usercp&amp;uid=734&amp;do=pm&amp;action=list">Mailbox</a>${
      unread === undefined ? '' : ` (<font color="#FF0000"><b>${unread}</b></font>)`}</td></tr></table>`;
  const hdExpected = { uploadedBytes: 12.5 * 1024 ** 3, downloadedBytes: 2.5 * 1024 ** 3,
    ratio: 5, seedBonus: '1,234.50', memberClass: 'Fixture Member', unreadMessages: undefined };
  for (const html of [hdHeader(), hdHeader().replaceAll('"', "'").replaceAll('&amp;', '&')]) {
    assert.deepEqual(extract(hdspace, html), hdExpected);
  }
  assert.deepEqual(extract(hdspace, hdHeader({ downloaded: '0.00 KB', ratio: '---', bonus: '---' })),
    { ...hdExpected, downloadedBytes: 0, ratio: undefined, seedBonus: undefined });
  assert.deepEqual(extract(hdspace, hdHeader({ uploaded: '0 B', downloaded: '0.00 KB', ratio: '0.00', bonus: '0', unread: '0' })),
    { ...hdExpected, uploadedBytes: 0, downloadedBytes: 0, ratio: 0, seedBonus: '0', unreadMessages: 0 });
  assert.equal(extract(hdspace, hdHeader({ uploaded: '1,234.50 GB' })).uploadedBytes, 1234.5 * 1024 ** 3);
  assert.equal(extract(hdspace, hdHeader({ downloaded: '1.25&nbsp;GiB' })).downloadedBytes, 1.25 * 1024 ** 3);
  assert.equal(extract(hdspace, hdHeader({ uploaded: '2&#160;MB' })).uploadedBytes, 2 * 1024 ** 2);
  assert.equal(extract(hdspace, hdHeader({ bonus: '12 345,67' })).seedBonus, '12 345,67');
  for (const ratio of ['∞', 'Inf', 'Infinity', 'Infinite']) {
    assert.equal(extract(hdspace, hdHeader({ ratio })).ratio, '∞');
  }
  const blankHd = hdHeader({ uploaded: '', downloaded: '', ratio: '', bonus: '', rank: '', unread: '' });
  assert.deepEqual(extract(hdspace, blankHd), empty(hdspace));
  assert.equal(extract(hdspace, hdHeader({ uploaded: '' })).uploadedBytes, undefined,
    'Missing UP must not capture DL or another table cell');
  assert.equal(extract(hdspace, hdHeader({ uploaded: '25' })).uploadedBytes, undefined);
  const unrelatedHd = '<td class="green">Total UP: 999 GB</td><td class="red">Global DL: 999 GB</td>'
    + '<td class="yellow">Global Ratio: 999</td><a href="index.php?page=other">Bonus: 999</a>'
    + '<td>Global Rank: Administrator</td><td><font color="#FF0000"><b>999</b></font></td>';
  assert.deepEqual(extract(hdspace, blankHd + unrelatedHd), empty(hdspace));
  assert.equal(extract(hdspace, hdHeader({ unread: '7' })).unreadMessages, 7);
  assert.equal(extract(hdspace, hdHeader({ unread: '7' }).replace('action=list', 'action=read')).unreadMessages, undefined);
  assert.equal(extract(hdspace, hdHeader({ unread: '7' }).replace('do=pm', 'do=invite')).unreadMessages, undefined);
  assert.equal(extract(hdspace, hdHeader({ unread: '7' }).replace('</a> (<font', '</a></td><td> (<font')).unreadMessages, undefined,
    'Mailbox must not capture a counter in another cell');
  assert.equal(hdspace.fetch.fields.seeding, undefined, 'No active torrent count was present in the verified header');
  assert.equal(hdspace.fetch.fields.leeching, undefined);
  assert.equal(hdspace.fetch.mode, 'browser');
  assert.equal(hdspace.dashboard.byteUnit, 'binary');
  assert.equal(hdspace.enabled, false);
  assert.equal(hdspace.login.cookieOnly, undefined);
  assert.deepEqual(hdspace.login.body, { uid: '{{username}}', pwd: '{{password}}' });
  for (const login of ['<form><input name="uid"><input type="password" name="pwd"></form>',
    "<form><input name='uid'><input type='password' name='pwd'></form>"]) {
    assert.ok(hdspace.login.failurePatterns.some(pattern => login.includes(pattern)));
    assert.deepEqual(extract(hdspace, login + unrelatedHd), empty(hdspace));
  }
  assert.ok(!hdspace.login.failurePatterns.some(pattern => hdHeader().includes(pattern)));

  const yuscene = applyEnginePreset(yusceneRaw);
  assert.equal(yusceneRaw.engine, 'unit3d');
  assert.equal(yusceneRaw.enabled, false);
  assert.equal(yusceneRaw.fetch, undefined, 'YUSCENE should inherit the common engine');
  // Sanitized browser-verified ratio-bar structure, with independent synthetic values.
  const yuHeader = ({ uploaded = '64&nbsp;GiB', downloaded = '2&nbsp;GiB', ratio = '32',
    seeding = '6', leeching = '1', buffer = '62&nbsp;GiB', bonus = '456.25', tokens = '4' } = {}) =>
    '<ul class="top-nav__ratio-bar">' + [
      ['uploaded', 'Upload', 'fa-arrow-up', uploaded], ['downloaded', 'Download', 'fa-arrow-down', downloaded],
      ['seeding', 'Seeding', 'fa-upload', seeding], ['leeching', 'Leeching', 'fa-download', leeching],
      ['buffer', 'Buffer', 'fa-exchange', buffer], ['points', 'My bonus points', 'fa-coins', bonus],
      ['ratio', 'Ratio', 'fa-sync-alt', ratio], ['tokens', 'My FL tokens', 'fa-star', tokens],
    ].map(([name, title, icon, value]) => `<li class="ratio-bar__${name}" title="${title}">
      <a href="https://yu-scene.net/users/synthetic-member"><i class="fas ${icon}"></i>
      ${value}</a></li>`).join('') + '</ul>';
  const yuExpected = { uploadedBytes: 64 * 1024 ** 3, downloadedBytes: 2 * 1024 ** 3, ratio: 32,
    seeding: 6, leeching: 1, seedBonus: '456.25', bufferBytes: 62 * 1024 ** 3, tokens: 4, unreadMessages: undefined };
  for (const html of [yuHeader(), yuHeader().replaceAll('&nbsp;', '\u00a0'), yuHeader().replaceAll('&nbsp;', '&#160;'),
    yuHeader().replaceAll('&nbsp;', '&#xa0;').replaceAll('"', "'")]) {
    assert.deepEqual(extract(yuscene, html), yuExpected, 'All eight visible UNIT3D header fields must extract');
  }
  // Torrenteros has the same live-verified structure with Spanish titles.
  const torrenteros = applyEnginePreset(torrenterosRaw);
  const spanishTitles = { Upload: 'Subir', Download: 'Descargar', Seeding: 'Compartiendo', Leeching: 'Descargando',
    'My bonus points': 'Mis puntos de bonificación', 'My FL tokens': 'Mis cupones de FL' };
  const torrenterosHeader = yuHeader().replaceAll('https://yu-scene.net', 'https://torrenteros.org')
    .replace(/title="([^"]+)"/g, (attribute, title) => `title="${spanishTitles[title] ?? title}"`);
  assert.deepEqual(extract(torrenteros, torrenterosHeader), yuExpected);
  assert.deepEqual(extract(yuscene, yuHeader({ uploaded: '0&nbsp;B', downloaded: '0&nbsp;B', ratio: '0',
    seeding: '0', leeching: '0', buffer: '0&nbsp;B', bonus: '0', tokens: '0' })), {
    uploadedBytes: 0, downloadedBytes: 0, ratio: 0, seeding: 0, leeching: 0, seedBonus: '0',
    bufferBytes: 0, tokens: 0, unreadMessages: undefined,
  });
  assert.deepEqual(extract(yuscene, '<ul class="top-nav__ratio-bar"></ul>'), empty(yuscene));
  const yuBlank = yuHeader({ uploaded: '', downloaded: '', ratio: '', seeding: '', leeching: '', buffer: '', bonus: '', tokens: '' });
  const unrelatedUnit3d = '<li class="global-stats"><a><i class="fas fa-arrow-up"></i>999 GiB</a></li>';
  assert.deepEqual(extract(yuscene, yuBlank + unrelatedUnit3d), empty(yuscene),
    'Empty UNIT3D values must not capture adjacent ratio cells or global counters');
  for (const [option, field] of [['uploaded', 'uploadedBytes'], ['downloaded', 'downloadedBytes'], ['ratio', 'ratio'],
    ['seeding', 'seeding'], ['leeching', 'leeching'], ['buffer', 'bufferBytes'], ['bonus', 'seedBonus'], ['tokens', 'tokens']]) {
    assert.deepEqual(extract(yuscene, yuHeader({ [option]: '' })), { ...yuExpected, [field]: undefined },
      `${field}: a missing value must remain absent while neighbouring values still extract`);
  }
  assert.equal(extract(yuscene, yuHeader({ bonus: '12\u202f345' })).seedBonus, '12\u202f345');
  assert.equal(extract(yuscene, yuHeader({ ratio: '∞' })).ratio, '∞', 'UNIT3D renders a zero-download ratio as infinity');
  assert.equal(extract(yuscene, yuHeader({ buffer: '-2 GiB' })).bufferBytes, undefined,
    'The unsigned bytes transform must not turn a negative buffer into a positive value');
  assert.equal(extract(yuscene, yuHeader({ uploaded: '64', buffer: '∞' })).uploadedBytes, undefined);
  assert.equal(extract(yuscene, yuHeader({ buffer: '∞' })).bufferBytes, undefined);
  assert.equal(extract(yuscene, yuHeader().replace('class="ratio-bar__tokens"', 'class="ratio-bar__tokens-history"')).tokens, undefined);

  // Official top-nav.blade.php gates this component on $hasUnreadPm. The same
  // component is also used for notifications/tickets, which are not private mail.
  // https://github.com/HDInnovations/UNIT3D/blob/master/resources/views/partials/top-nav.blade.php
  // https://github.com/HDInnovations/UNIT3D/blob/master/resources/views/components/animation/notification.blade.php
  const animation = '<svg viewBox="0 0 100 100" width="17px" height="17px">'
    + '<circle fill="transparent" stroke="#b6b6b6" stroke-width="10" cx="50" cy="50" r="15">'
    + '<animate attributeName="r" values="0;5;25;40;50" dur="1s" repeatCount="indefinite" />'
    + '<animate attributeName="opacity" values="0;.1;.3;.5;0" dur="1s" repeatCount="indefinite" /></circle>'
    + '<circle fill="#b6b6b6" cx="50" cy="50" r="15" /></svg>';
  const mailbox = ({ title = 'Inbox', icon = 'fa-envelope', unread = true } = {}) =>
    `<a class="top-nav--right__icon-link" href="https://tracker.example/users/fixture-user/conversations" title="${title}">`
    + `<i class="fas ${icon}"></i>${unread ? animation : ''}</a>`;
  for (const title of ['Inbox', 'Boîte de réception', 'Bandeja de entrada', 'Пријемно сандуче']) {
    for (const html of [mailbox({ title }), mailbox({ title }).replaceAll('"', "'")]) {
      assert.equal(extract(yuscene, html).unreadMessages, '1s', 'Preserve an unread presence signal, never invent a numeric count');
    }
  }
  assert.equal(extract(torrenteros, torrenterosHeader + mailbox({ title: 'Bandeja de entrada' })).unreadMessages, '1s');
  assert.equal(extract(yuscene, mailbox().replaceAll('dur="1s"', 'dur="3s"')).unreadMessages, '3s');
  for (const html of [mailbox({ unread: false }), mailbox({ icon: 'fa-bell' }), mailbox({ icon: 'fa-life-ring' }),
    mailbox({ unread: false }) + mailbox({ icon: 'fa-bell' }), mailbox({ unread: false }) + animation,
    mailbox().replace('top-nav--right__icon-link', 'message-body'),
    mailbox().replaceAll(' dur="1s"', ''), '<p>Boîte de réception</p>' + animation]) {
    assert.equal(extract(yuscene, html).unreadMessages, undefined,
      'No mailbox animation means no unread signal; unrelated alerts must not be counted');
  }
  console.log('Additional tracker extraction OK: BwTorrents, UniOtaku, HD-Space, YUSCENE and Torrenteros; account boundaries, units, optional values and localized UNIT3D unread signals.');
} finally {
  process.chdir(originalCwd);
  assert.equal(path.dirname(path.resolve(temp)), tempParent);
  assert.ok(path.basename(temp).startsWith('tracker-dashboard-additional-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
