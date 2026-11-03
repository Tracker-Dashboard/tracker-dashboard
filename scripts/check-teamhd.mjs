import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tracker = JSON.parse(fs.readFileSync(new URL('../config/trackers/teamhd.json', import.meta.url), 'utf8'));
const originalCwd = process.cwd();
const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'tracker-dashboard-teamhd-'));
const originalBrowserRuntimeUrl = process.env.BROWSER_RUNTIME_URL;
let sqlite;
let server;

try {
  // Isolate the production fetcher's cookie store and debug dumps from real accounts.
  process.chdir(temp);
  process.env.BROWSER_RUNTIME_URL = 'disabled:';
  const db = await import('../dist/db.js');
  const { extractExtraFieldResponse, fetchTracker, invalidateSession } = await import('../dist/fetcher.js');
  sqlite = db.getDb();
  db.setJsonSetting('fast_fetch', false);
  const extract = html => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
    field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
  ]));
  const loginDetected = html => tracker.login.failurePatterns.some(pattern => html.includes(pattern));

  // Verified account-header markup; every username, ID, rank and counter below is synthetic.
  const header = ({ uploaded = '1.25 TiB', downloaded = '512.00 GiB', ratio = '2.50',
    bonus = '12 345,67', seeding = '24', leeching = '3', rank = '1080p',
    inboxTotal = '27', unread = '4', tokens = '8' } = {}) => `
    <div class="col-8 mb-4"><a href="/user/id42"><span style="color:#000000" title="${rank}">fixture-user</span></a>
    <a href="/logout.php">Logout</a><br>
    <font color="#1900D1">Рейтинг:</font> ${ratio}&nbsp;&nbsp;
    <font color="green">Раздал:</font> ${uploaded}&nbsp;&nbsp;
    <font color="darkred">Скачал:</font> ${downloaded}&nbsp;&nbsp;
    <font color="darkblue">Бонус:</font> <a href="/mybonus.php" class="online" title="Потратить">${bonus}</a>&nbsp;&nbsp;
    <font color="#1900D1">Торренты:</font><img alt="Раздаёт" title="Раздаёт" src="/themes/teamhd_web/images/arrowup.gif">&nbsp;${seeding}&nbsp;&nbsp;
    <img alt="Качает" title="Качает" src="/themes/teamhd_web/images/arrowdown.gif">&nbsp;${leeching}</div>
    <div class="col-4 text-right mb-4">Текущее время: <span id="hour_min">09:12</span>&nbsp;&nbsp;
      <a href="/message.php"><img alt="inbox" title="Есть новые сообщения" src="/pic/pn_inboxnew.gif"></a> ${inboxTotal} (${unread} новых)&nbsp;
      <a href="/message.php?action=viewmailbox&amp;box=-1"><img alt="Отправленые" title="Отправленые" src="/pic/pn_sentbox.gif"></a> 19&nbsp;
      <a href="/friends.php"><img alt="Друзья" title="Друзья" src="/pic/buddylist.gif"></a></div>
    <div id="sb65"><font color="#c26458">Токенов:</font>&nbsp;&nbsp;&nbsp;
      <font color="#000000"><a href="/mytokens.php">${tokens}</a></font><br></div>`;
  const expected = {
    uploadedBytes: 1.25 * 1024 ** 4, downloadedBytes: 512 * 1024 ** 3, ratio: 2.5,
    seedBonus: '12 345,67', seeding: 24, leeching: 3, memberClass: '1080p', unreadMessages: 4, tokens: 8,
  };
  const unquoted = html => html.replace(/="([^"\s]+)"/g, '=$1');
  for (const page of [header(), header().replaceAll('"', "'"), unquoted(header())]) {
    assert.deepEqual(extract(page), expected);
    assert.equal(loginDetected(page), false);
  }
  assert.equal(extract(header({ rank: 'Power User' })).memberClass, 'Power User');

  assert.deepEqual(extract(header({ uploaded: '0.00 KiB', downloaded: '0.00 KiB', ratio: '---',
    bonus: '0', seeding: '0', leeching: '0' })), {
    uploadedBytes: 0, downloadedBytes: 0, ratio: undefined,
    seedBonus: '0', seeding: 0, leeching: 0, memberClass: '1080p', unreadMessages: 4, tokens: 8,
  });
  assert.equal(extract(header({ ratio: '0.00' })).ratio, 0);
  assert.equal(extract(header({ uploaded: '1.5&nbsp;GiB' })).uploadedBytes, 1.5 * 1024 ** 3);
  assert.equal(extract(header({ downloaded: '2&#160;MiB' })).downloadedBytes, 2 * 1024 ** 2);
  assert.equal(extract(header({ uploaded: '1,234.50 GiB' })).uploadedBytes, 1234.5 * 1024 ** 3);
  for (const ratio of ['∞', 'inf', 'Infinite', 'Infinity']) {
    assert.equal(extract(header({ ratio })).ratio, '∞');
  }
  for (const bonus of ['1,234.50', '12 345,67', '1234.500']) {
    assert.equal(extract(header({ bonus })).seedBonus, bonus, 'Preserve the site’s bonus formatting');
  }

  assert.deepEqual(extract(header({ inboxTotal: '93', unread: '7', tokens: '12' })), {
    ...expected, unreadMessages: 7, tokens: 12,
  }, 'Unread messages must use the parenthesized count, not the inbox total');
  assert.deepEqual(extract(header({ unread: '0', tokens: '0' })), {
    ...expected, unreadMessages: 0, tokens: 0,
  }, 'Explicit zero optional counters must remain zero');
  assert.deepEqual(extract(header({ unread: '', tokens: '' })), {
    ...expected, unreadMessages: undefined, tokens: undefined,
  }, 'Missing optional counters must remain absent');
  for (const inboxTotal of ['27', '0']) {
    assert.equal(extract(header({ inboxTotal }).replace(' (4 новых)', '')).unreadMessages, undefined,
      'An inbox total without an explicit unread count is not an unread value');
  }
  assert.equal(extract(header().replace('href="/message.php"', 'href="/message.php?action=viewmailbox&amp;box=-1"')).unreadMessages, undefined,
    'A sent mailbox link must not be counted as the inbox');
  assert.equal(extract(header().replace('src="/pic/pn_inboxnew.gif"', 'src="/pic/pn_sentbox.gif"')).unreadMessages, undefined);
  assert.equal(extract(header().replace('alt="inbox"', 'alt="sent"')).unreadMessages, undefined);
  assert.equal(extract(header().replace('Токенов:', 'Всего:')).tokens, undefined);
  assert.equal(extract(header().replace('href="/mytokens.php"', 'href="/globaltokens.php"')).tokens, undefined);

  const unrelatedOptional = `<section><a href="/message.php"><img alt="inbox" src="/pic/pn_inboxnew.gif"></a> 83 (16 новых)
    <font>Токенов:</font><font><a href="/mytokens.php">37</a></font></section>`;
  assert.equal(extract(header({ unread: '' }) + unrelatedOptional).unreadMessages, undefined,
    'An empty header count must not capture another account block');
  assert.equal(extract(header({ tokens: '' }) + unrelatedOptional).tokens, undefined,
    'An empty token balance must not capture another block');
  assert.equal(extract(header().replace('class="col-4 text-right mb-4"', 'class="other-account"') + unrelatedOptional).unreadMessages, undefined);
  assert.equal(extract(header().replace('id="sb65"', 'id="global-tokens"') + unrelatedOptional).tokens, undefined);

  const emptyStats = Object.fromEntries(Object.keys(expected).map(field => [field, undefined]));
  const globalStats = `<section><a href="/user/id99"><span title="Administrator">fixture-other-user</span></a>
    <font color="green">Раздал:</font> 999 TiB<font color="darkred">Скачал:</font> 500 TiB
    <font color="#1900D1">Рейтинг:</font> 100.00<a href="/mybonus.php" class="online">99999</a>
    <img src="/themes/teamhd_web/images/arrowup.gif">9999<img src="/themes/teamhd_web/images/arrowdown.gif">999</section>` + unrelatedOptional;
  assert.deepEqual(extract(globalStats), emptyStats, 'Global counters and other users are not account stats');
  assert.deepEqual(extract(header({ uploaded: '', downloaded: '', ratio: '', bonus: '', seeding: '', leeching: '', rank: '', unread: '', tokens: '' }) + globalStats),
    emptyStats, 'Missing values must not cross the end of the account header');
  assert.deepEqual(extract(header({ uploaded: '25', downloaded: '12', ratio: '---' })), {
    ...expected, uploadedBytes: undefined, downloadedBytes: undefined, ratio: undefined,
  }, 'Traffic totals require a byte unit');
  assert.equal(extract(header({ uploaded: '' })).uploadedBytes, undefined, 'Upload must not capture download');
  assert.equal(extract(header({ rank: '' }) + globalStats).memberClass, undefined);
  assert.equal(extract(header().replace(' title="1080p"', '') + globalStats).memberClass, undefined,
    'A missing rank must not capture another title from the header or online members');
  assert.deepEqual(extract(globalStats + header() + globalStats), expected);

  const login = `<html lang=ru><title>Вход::TeamHD</title><form method="post" action="takelogin.php">
    <input name="username"><input type="password" name="password">
    <input type="hidden" name="returnto" value="index.php"><div class="g-recaptcha"></div></form></html>`;
  for (const page of [login, login.replaceAll('"', "'"), unquoted(login)]) {
    assert.equal(loginDetected(page), true);
    assert.deepEqual(extract(page + globalStats), emptyStats);
  }
  assert.equal(loginDetected('<title>TeamHD</title>' + header()), false);
  assert.equal(tracker.enabled, false);
  assert.equal(tracker.fetch.mode, 'http');
  assert.equal(tracker.fetch.url, 'index.php');
  assert.equal(tracker.fetch.extraFetch, undefined);
  assert.equal(tracker.dashboard.byteUnit, 'binary');
  assert.equal(tracker.login.cookieOnly, true);
  assert.equal(tracker.login.url, 'login.php');
  assert.equal(tracker.login.postUrl, 'takelogin.php');
  assert.deepEqual(tracker.login.body, { username: '{{username}}', password: '{{password}}', returnto: 'index.php' });
  assert.match(tracker.login.cookieInstructions, /CAPTCHA/);

  // Exercise the real HTTP path against localhost: a valid cookie fetches stats;
  // an expired cookie reports an error and never submits the CAPTCHA login form.
  const requests = [];
  let expired = false;
  server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, cookie: request.headers.cookie });
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(!expired && request.headers.cookie === 'fixture_session=synthetic' ? header() : login);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const localTracker = { ...tracker, id: 'teamhd-fixture', baseUrl: `http://127.0.0.1:${server.address().port}` };
  db.setTrackerCookie(localTracker.id, 'fixture_session=synthetic');
  const credentials = { username: 'fixture-user', password: 'unused-synthetic-password' };
  const valid = await fetchTracker(localTracker, credentials);
  assert.equal(valid.status, 'ok');
  assert.deepEqual(valid.fields, expected);
  assert.equal(valid.byteUnit, 'binary');
  assert.equal(requests[0].cookie, 'fixture_session=synthetic');
  expired = true;
  invalidateSession(localTracker.id);
  const rejected = await fetchTracker(localTracker, credentials);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.error, /cookie refuse/);
  assert.deepEqual(rejected.fields, {});
  assert.ok(requests.every(request => ['GET', 'HEAD'].includes(request.method)), 'Cookie-only must never POST credentials');
  assert.ok(requests.every(request => !request.url.includes('login.php')), 'Cookie-only must never request either login endpoint');

  console.log('TeamHD extraction OK: account header, binary units, absent ratio, bonus, rank, explicit unread messages/tokens and cookie-only sessions.');
} finally {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  sqlite?.close();
  process.chdir(originalCwd);
  if (originalBrowserRuntimeUrl === undefined) delete process.env.BROWSER_RUNTIME_URL;
  else process.env.BROWSER_RUNTIME_URL = originalBrowserRuntimeUrl;
  assert.equal(path.dirname(path.resolve(temp)), tempParent);
  assert.ok(path.basename(temp).startsWith('tracker-dashboard-teamhd-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
