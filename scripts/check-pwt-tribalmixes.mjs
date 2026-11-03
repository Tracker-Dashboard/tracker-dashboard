import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const readTracker = id => JSON.parse(fs.readFileSync(new URL(`../config/trackers/${id}.json`, import.meta.url), 'utf8'));
const pwt = readTracker('pwtorrents');
const tribal = readTracker('tribalmixes');
const originalCwd = process.cwd();
const originalBrowserRuntimeUrl = process.env.BROWSER_RUNTIME_URL;
const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'tracker-dashboard-pwt-tribal-'));
let sqlite;
let server;

try {
  process.chdir(temp);
  process.env.BROWSER_RUNTIME_URL = 'disabled:';
  const db = await import('../dist/db.js');
  const { extractExtraFieldResponse, fetchExtraField, fetchTracker } = await import('../dist/fetcher.js');
  sqlite = db.getDb();
  db.setJsonSetting('fast_fetch', false);
  const extract = (tracker, html) => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
    field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
  ]));
  const empty = tracker => Object.fromEntries(Object.keys(tracker.fetch.fields).map(field => [field, undefined]));
  const credentials = { username: 'synthetic-member', password: 'synthetic-password' };

  // Live-verified PWTorrents markup, with synthetic values/ID. TBDev's mksize divides
  // by powers of 1024 while printing kB/MB/GB, and userdetails uses mksize for totals:
  // https://github.com/thetooi/TBDev/blob/master/include/bittorrent.php#L162-L171
  // https://github.com/thetooi/TBDev/blob/master/userdetails.php#L171-L172
  const pwtLanding = '<h1>Welcome, <a href="userdetails.php?id=734">synthetic-member</a>!</h1><a href="logout.php">Logout</a>';
  const pwtProfile = ({ uploaded = '12.50 GB', downloaded = '2.50 GB', rank = 'Fixture User', daily = '999.99 TB' } = {}) =>
    `<table><tr><td class="rowhead">Uploaded</td><td align="left">${uploaded}&nbsp;(Daily: ${daily})</td></tr>
    <tr><td class="rowhead">Downloaded</td><td align="left">${downloaded}&nbsp;(Daily: ${daily})</td></tr>
    <tr><td class="rowhead">Class</td><td align="left">${rank}</td></tr></table>`;
  const pwtExpected = { uploadedBytes: 12.5 * 1024 ** 3, downloadedBytes: 2.5 * 1024 ** 3, memberClass: 'Fixture User' };
  for (const html of [pwtProfile(), pwtProfile().replaceAll('"', "'")]) {
    assert.deepEqual(extract(pwt, html), pwtExpected);
  }
  assert.deepEqual(extract(pwt, pwtProfile({ uploaded: '0.00 kB', downloaded: '0.00 kB' })),
    { ...pwtExpected, uploadedBytes: 0, downloadedBytes: 0 });
  assert.equal(extract(pwt, pwtProfile({ uploaded: '1.25 kB' })).uploadedBytes, 1280);
  assert.equal(extract(pwt, pwtProfile({ uploaded: '1,234.50 GB' })).uploadedBytes, 1234.5 * 1024 ** 3);
  assert.equal(extract(pwt, pwtProfile({ downloaded: '1.5&#160;MB' })).downloadedBytes, 1.5 * 1024 ** 2);
  assert.equal(extract(pwt, pwtProfile({ uploaded: '1.25 GiB' })).uploadedBytes, 1.25 * 1024 ** 3);
  assert.equal(extract(pwt, pwtProfile({ uploaded: '' })).uploadedBytes, undefined, 'Daily averages are not account totals');
  assert.equal(extract(pwt, pwtProfile({ uploaded: '25' })).uploadedBytes, undefined, 'A byte unit is required');
  const blankPwt = pwtProfile({ uploaded: '', downloaded: '', rank: '' });
  const unrelatedPwt = pwtProfile().replaceAll('rowhead', 'torrent-total');
  assert.deepEqual(extract(pwt, blankPwt + unrelatedPwt), empty(pwt));
  assert.deepEqual(extract(pwt, pwtLanding), empty(pwt), 'The landing page intentionally has no traffic stats');
  let profileRequests = 0;
  const pwtExtra = await fetchExtraField(pwt, '<a href="userdetails.php?id=999">Other user</a>' + pwtLanding,
    async url => {
      profileRequests += 1;
      assert.equal(url, 'https://pwtorrents.net/userdetails.php?id=734');
      return { status: 200, body: pwtProfile() };
    }, {}, credentials);
  assert.deepEqual(pwtExtra, { field: 'uploadedBytes', value: pwtExpected.uploadedBytes,
    extras: { downloadedBytes: pwtExpected.downloadedBytes, memberClass: pwtExpected.memberClass }, byteUnit: 'binary' });
  for (const html of ['<a href="userdetails.php?id=999">Other user</a>', '<h1>Welcome, </h1>' + pwtLanding.replace('Welcome,', 'Member:')]) {
    assert.equal(await fetchExtraField(pwt, html, async () => { profileRequests += 1; return null; }, {}, credentials), null);
  }
  assert.equal(profileRequests, 1, 'Only the welcome heading identifies the own profile');
  for (const field of ['ratio', 'seedBonus', 'seeding', 'leeching', 'unreadMessages']) {
    assert.equal(pwt.fetch.fields[field], undefined, 'Do not invent fields absent from the verified PWT profile');
  }

  // TribalMixes' verified ratio dropdown; all values and transfer links are synthetic.
  const tribalHeader = ({ ratio = '4.50', seeding = '12', leeching = '3' } = {}) => `<li class="nav-item dropdown">
    <a class="nav-link dropdown-toggle" href="/help.php" id="dropdownRatio"><i class="material-icons">insert_chart_outlined</i></a>
    <div class="dropdown-menu"><a class="dropdown-item" href="/help.php"><i class="material-icons">child_care</i>
    My Share Ratio: <strong>${ratio}</strong></a><div class="dropdown-divider"></div>
    <a class="dropdown-item" href="/transfers.php">seeding <strong>${seeding}</strong> torrents</a>
    <a class="dropdown-item" href="/transfers.php"><strong>${leeching}</strong> downloading now</a></div></li>`;
  for (const html of [tribalHeader(), tribalHeader().replaceAll('"', "'")]) {
    assert.deepEqual(extract(tribal, html), { ratio: 4.5, seeding: 12, leeching: 3 });
  }
  assert.deepEqual(extract(tribal, tribalHeader({ ratio: 'd.n.a.', seeding: '0', leeching: '0' })),
    { ratio: undefined, seeding: 0, leeching: 0 });
  assert.equal(extract(tribal, tribalHeader({ ratio: '0.00' })).ratio, 0);
  assert.equal(extract(tribal, tribalHeader({ ratio: '∞' })).ratio, '∞');
  const unrelatedTribal = tribalHeader().replace('dropdownRatio', 'globalStats');
  const blankTribal = tribalHeader({ ratio: '', seeding: '', leeching: '' });
  assert.deepEqual(extract(tribal, unrelatedTribal), empty(tribal));
  assert.deepEqual(extract(tribal, blankTribal + unrelatedTribal), empty(tribal));
  for (const field of ['uploadedBytes', 'downloadedBytes', 'memberClass', 'seedBonus', 'unreadMessages']) {
    assert.equal(tribal.fetch.fields[field], undefined, 'No unsupported optional values from navigation labels');
  }
  for (const tracker of [pwt, tribal]) {
    assert.equal(tracker.enabled, false);
    assert.equal(tracker.login.url, 'login.php');
    assert.equal(tracker.login.postUrl, 'takelogin.php');
    assert.deepEqual(tracker.login.body, { username: '{{username}}', password: '{{password}}' });
    assert.equal(tracker.login.cookieOnly, undefined);
  }

  // Exercise the actual PWT definition through login + landing + own-profile HTTP.
  let scenario = 'success';
  const requests = [];
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, id: url.searchParams.get('id'), method: request.method, cookie: request.headers.cookie });
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/takelogin.php') {
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.deepEqual(Object.fromEntries(new URLSearchParams(body)), credentials);
      response.writeHead(302, { Location: '/my.php', 'Set-Cookie': 'fixture_session=synthetic; Path=/' });
      response.end();
    } else if (url.pathname === '/my.php') {
      response.end(scenario === 'missing-id' ? '<h1>Welcome, synthetic-member!</h1>' : pwtLanding);
    } else if (url.pathname === '/userdetails.php') {
      assert.equal(request.headers.cookie, 'fixture_session=synthetic');
      response.end(scenario === 'private' ? '<form><input name="password"></form>' + pwtProfile()
        : scenario === 'empty' ? blankPwt : pwtProfile({ uploaded: '0.00 kB', downloaded: '2.50 GB' }));
    } else {
      response.end('Fixture reachable');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  for (scenario of ['success', 'missing-id', 'empty', 'private']) {
    const tracker = { ...pwt, id: `pwt-fixture-${scenario}`, baseUrl: `http://127.0.0.1:${server.address().port}` };
    const result = await fetchTracker(tracker, credentials);
    assert.equal(result.status, scenario === 'success' ? 'ok' : 'error', result.error);
    if (scenario === 'success') {
      assert.deepEqual(result.fields, { ...pwtExpected, uploadedBytes: 0 });
      assert.equal(result.byteUnit, 'binary');
    } else assert.deepEqual(result.fields, {});
  }
  assert.ok(requests.filter(request => request.path === '/userdetails.php').every(request => request.id === '734'));
  console.log('PWTorrents and TribalMixes OK: own-profile totals/rank, TBDev binary units, daily-average exclusion, scoped header counts, zero/absent data and synthetic HTTP login.');
} finally {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  sqlite?.close();
  process.chdir(originalCwd);
  if (originalBrowserRuntimeUrl === undefined) delete process.env.BROWSER_RUNTIME_URL;
  else process.env.BROWSER_RUNTIME_URL = originalBrowserRuntimeUrl;
  assert.equal(path.dirname(path.resolve(temp)), tempParent);
  assert.ok(path.basename(temp).startsWith('tracker-dashboard-pwt-tribal-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
