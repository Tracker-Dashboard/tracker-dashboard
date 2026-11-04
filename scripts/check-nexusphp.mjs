import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ids = ['okpt', '52pt', 'carpt', 'pandapt', 'ubits', 'hdvideo', 'ptitzmx', 'kufei', 'nethd', 'teamctgame'];
const trackers = ids.map(id => JSON.parse(fs.readFileSync(new URL(`../config/trackers/${id}.json`, import.meta.url), 'utf8')));
const originalCwd = process.cwd();
const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'tracker-dashboard-nexusphp-'));

try {
  // Import after changing cwd: production modules must never open a real account database here.
  process.chdir(temp);
  const { extractExtraFieldResponse } = await import('../dist/fetcher.js');
  const extract = (tracker, html) => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
    field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
  ]));
  const empty = tracker => Object.fromEntries(Object.keys(tracker.fetch.fields).map(field => [field, undefined]));
  const loginDetected = (tracker, html) => tracker.login.failurePatterns.some(pattern => html.includes(pattern));

  // Synthetic fixtures from official NexusPHP 1.5 and maintained upstream header markup:
  // https://sourceforge.net/projects/nexusphp/files/nexusphp.v1.5.beta5.20120707.zip/download
  // https://github.com/xiaomlove/nexusphp/blob/php8/include/functions.php
  // mksize() divides by 1024 while displaying KB/MB/GB/TB/PB; bytesBinary is intentional.
  // Header H&R is inspecting / red unreached / ban threshold, not three violation counts:
  // https://github.com/xiaomlove/nexusphp/blob/php8/app/Repositories/HitAndRunRepository.php
  // These fixtures establish upstream support, not authenticated verification of each deployment.
  const locales = {
    en: ['Ratio:', 'Uploaded:', 'Downloaded:', 'Bonus ', 'Use', 'Active:', ' New'],
    chs: ['分享率:', '上传量:', '下载量:', '魔力值 ', '使用', '当前活动:', ' 新'],
    cht: ['分享率：', '上傳量：', '下載量：', '魔力值 ', '使用', '當前活動：', ' 新'],
    fr: ['Ratio', 'Envoyé :', 'Téléchargé :', 'Bonus ', 'Utiliser', 'Actif :', ' Nouveau'],
  };
  const header = (locale = 'en', options = {}) => {
    const [ratioLabel, uploadedLabel, downloadedLabel, bonusLabel, useLabel, activeLabel, newLabel] = locales[locale];
    const o = { uploaded: '125.50 GB', downloaded: '25.10 GB', ratio: '<font color="green">5.000</font>',
      bonus: '12,345.6', rank: 'PowerUser', seeding: '7', leeching: '2', total: 50, unread: 3,
      inbox: true, hr: '4/<font color="red">1</font>/5', ...options };
    return `<table id="info_block" cellpadding="4" cellspacing="0" border="0" width="100%"><tr><td>
      <table width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
      <td class="bottom" align="left"><span class="medium">Welcome,
        <a href="userdetails.php?id=123"${o.rank ? ` class='${o.rank}_Name'` : ''}><b>FixtureMember</b></a>
        [<a href="logout.php">Logout</a>]
        <font class = 'color_bonus'>${bonusLabel}</font>[<a href="mybonus.php">${useLabel}</a>]: ${o.bonus}
        <font class='color_invite'>Invites</font>[<a href="invite.php?id=123">Send</a>]: 2<br />
        <font class="color_ratio">${ratioLabel}</font> ${o.ratio}
        <font class='color_uploaded'>${uploadedLabel}</font> ${o.uploaded}<font class='color_downloaded'>${downloadedLabel}</font> ${o.downloaded}
        <font class='color_active'>${activeLabel}</font> <img class="arrowup" alt="Torrents seeding" title="Localized title" src="pic/trans.gif" />${o.seeding}
        <img class="arrowdown" alt="Torrents leeching" title="Localized title" src="pic/trans.gif" />${o.leeching}&nbsp;&nbsp;<font class='color_connectable'>Connectable:</font>Yes
        ${o.hr === null ? '' : `<font class='color_bonus'>H&R: </font>[<a href="myhr.php">${o.hr}</a>]`}
      </span></td>
      <td class="bottom" align="right"><span class="medium">
        <a href="staffbox.php"><img class="staffbox" src="pic/trans.gif" /></a>44
        ${o.inbox ? `<a href="messages.php"><img class="${o.unread ? 'inboxnew' : 'inbox'}" src="pic/trans.gif" alt="inbox" title="Localized inbox title" /></a> ${o.total ? `${o.total} (${o.unread}${newLabel})` : '0'}` : ''}
        <a href="messages.php?action=viewmailbox&amp;box=-1"><img class="sentbox" src="pic/trans.gif" /></a>99
      </span></td></tr></table>
    </td></tr></table>`;
  };
  const expected = {
    uploadedBytes: Math.round(125.5 * 1024 ** 3), downloadedBytes: Math.round(25.1 * 1024 ** 3), ratio: 5,
    seedBonus: '12,345.6', seeding: 7, leeching: 2, memberClass: 'PowerUser', unreadMessages: 3, hitAndRuns: 1,
  };
  const login = '<form id="loginform" action="takelogin.php" method="post"><input name="username"><input type="password" name="password"></form>';
  for (const tracker of trackers) {
    assert.deepEqual(extract(tracker, header()), expected, `${tracker.id}: extract the configured fields`);
    assert.equal(tracker.enabled, false, `${tracker.id}: adding a definition must not enable an account`);
    assert.equal(loginDetected(tracker, header()), false);
    for (const html of [login, login.replaceAll('"', "'"), login.replace(/="([^"\s]+)"/g, '=$1')]) {
      assert.equal(loginDetected(tracker, html), true, `${tracker.id}: detect a returned login form`);
      assert.deepEqual(extract(tracker, html), empty(tracker));
    }
    if (tracker.id === 'nethd') {
      assert.notEqual(tracker.login.cookieOnly, true, 'NetHD has a normal credential form');
    } else {
      assert.equal(tracker.login.cookieOnly, true, `${tracker.id}: preserve browser login for CAPTCHA or restricted login pages`);
      assert.ok(tracker.login.cookieInstructions?.includes('Cookie'));
    }
  }

  const tracker = trackers[0];
  for (const locale of Object.keys(locales)) {
    for (const html of [header(locale), header(locale).replaceAll('"', "'")]) {
      assert.deepEqual(extract(tracker, html), expected, `${locale}: localized labels and attribute quotes`);
    }
  }
  const binaryResult = extractExtraFieldResponse({ field: 'uploadedBytes', ...tracker.fetch.fields.uploadedBytes }, header());
  assert.equal(binaryResult.byteUnit, 'binary');
  assert.deepEqual(extract(tracker, header('cht', { uploaded: '0.00 KB', downloaded: '0.00 KB', ratio: '---',
    bonus: '0.0', rank: 'User', seeding: '0', leeching: '0', total: 0, unread: 0, hr: '0/<font color="red">0</font>/5' })), {
    uploadedBytes: 0, downloadedBytes: 0, ratio: undefined, seedBonus: '0.0', seeding: 0, leeching: 0,
    memberClass: 'User', unreadMessages: 0, hitAndRuns: 0,
  });
  assert.equal(extract(tracker, header('en', { ratio: '0.000' })).ratio, 0);
  assert.deepEqual(extract(tracker, header('en', { bonus: '—', rank: '', seeding: '', leeching: '—', inbox: false, hr: null })), {
    ...expected, seedBonus: undefined, memberClass: undefined, seeding: undefined, leeching: undefined,
    unreadMessages: undefined, hitAndRuns: undefined,
  }, 'Absent optional fields must not become zero');

  assert.deepEqual(extract(tracker, header('en', { uploaded: '1.250 PB', downloaded: '250.000 TB', ratio: '5.120' })), {
    ...expected, uploadedBytes: 1.25 * 1024 ** 5, downloadedBytes: 250 * 1024 ** 4, ratio: 5.12,
  });
  assert.equal(extract(tracker, header('en', { uploaded: '1.5&nbsp;GB' })).uploadedBytes, 1.5 * 1024 ** 3);
  assert.equal(extract(tracker, header('en', { downloaded: '2&#160;MB' })).downloadedBytes, 2 * 1024 ** 2);
  assert.equal(extract(tracker, header('en', { uploaded: '123.45' })).uploadedBytes, undefined, 'Require a byte unit');
  assert.equal(extract(tracker, header('en', { uploaded: '' })).uploadedBytes, undefined, 'Never capture downloaded as uploaded');
  for (const ratio of ['Inf.', 'Inf', 'Infinity', '∞']) {
    assert.deepEqual(extract(tracker, header('en', { uploaded: '1.00 GB', downloaded: '0.00 KB', ratio })), {
      ...expected, uploadedBytes: 1024 ** 3, downloadedBytes: 0, ratio: '∞',
    });
  }
  for (const [locale, ratio] of [['chs', '无限'], ['cht', '無限']]) {
    assert.deepEqual(extract(tracker, header(locale, { uploaded: '1.00 GB', downloaded: '0.00 KB', ratio })), {
      ...expected, uploadedBytes: 1024 ** 3, downloadedBytes: 0, ratio: undefined,
    }, 'Chinese infinity must stay absent so the UI derives infinity from transfer totals, never a false zero');
  }

  assert.equal(extract(tracker, header('en', { total: 93, unread: 7 })).unreadMessages, 7, 'Read the unread count, not total messages');
  assert.equal(extract(tracker, header('en', { total: 20, unread: 0 })).unreadMessages, 0);
  assert.equal(extract(tracker, header('en', { total: 20 }).replace('20 (3 New)', '20')).unreadMessages, undefined);
  assert.equal(extract(tracker, header().replace('href="messages.php"', 'href="messages.php?action=viewmailbox&amp;box=-1"')).unreadMessages, undefined);
  assert.equal(extract(tracker, header().replace('class="inboxnew"', 'class="staffbox"')).unreadMessages, undefined);
  assert.equal(extract(tracker, header('en', { hr: '17/<font color="red">2</font>/9' })).hitAndRuns, 2, 'Only red unreached H&R are violations');
  for (const hr of [null, '17/2/9', 'Movies: 4/<font color="red">1</font>/5 Music: 3/<font color="red">2</font>/5',
    '4/<font color="red">1</font>/5 3/<font color="red">2</font>/5']) {
    assert.equal(extract(tracker, header('en', { hr })).hitAndRuns, undefined, 'Do not infer H&R or partially count multiple sections');
  }
  assert.equal(extract(tracker, header().replace('href="mybonus.php"', 'href="claim.php"')).seedBonus, undefined,
    'Other color_bonus labels such as claims and H&R are not the bonus balance');

  const unrelated = header('en', { uploaded: '999.00 TB', rank: 'Administrator', unread: 99 }).replace('id="info_block"', 'id="global_stats"');
  const blank = header('en', { uploaded: '', downloaded: '', ratio: '---', bonus: '', rank: '', seeding: '', leeching: '', inbox: false, hr: null });
  assert.deepEqual(extract(tracker, unrelated), empty(tracker));
  assert.deepEqual(extract(tracker, blank + unrelated), empty(tracker), 'Missing account values must not cross into later tables');
  assert.deepEqual(extract(tracker, '<table id="info_block"><tr><td>Loading</td></tr></table>' + unrelated), empty(tracker));
  assert.deepEqual(extract(tracker, unrelated + header() + unrelated), expected, 'Ignore global counters on either side of the account header');
  console.log('NexusPHP extraction OK: 10 definitions, localized headers, binary units, infinity, optional counters, H&R and account boundaries.');
} finally {
  process.chdir(originalCwd);
  assert.equal(path.dirname(path.resolve(temp)), tempParent);
  assert.ok(path.basename(temp).startsWith('tracker-dashboard-nexusphp-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
