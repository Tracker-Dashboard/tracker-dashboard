import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const originalBrowserRuntimeUrl = process.env.BROWSER_RUNTIME_URL;
const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'tracker-dashboard-profile-only-'));
let sqlite;
let server;

try {
  // All database, cookie and debug writes remain inside this synthetic fixture directory.
  process.chdir(temp);
  process.env.BROWSER_RUNTIME_URL = 'disabled:';
  const db = await import('../dist/db.js');
  const { fetchTracker } = await import('../dist/fetcher.js');
  sqlite = db.getDb();
  db.setJsonSetting('fast_fetch', false);

  const profile = ({ uploaded = '0 GB', downloaded = '2 GB', rank = 'Fixture Member' } = {}) =>
    `<table><tr><td>Uploaded:</td><td>${uploaded}</td></tr>
    <tr><td>Downloaded:</td><td>${downloaded}</td></tr>
    <tr><td>Class:</td><td>${rank}</td></tr></table>`;
  const ownLink = '<a href="/userdetails.php?id=734" class="my-profile">synthetic-member</a>';
  const navigation = `<nav>${ownLink}<a href="/logout.php">Logout</a></nav>`;
  const login = '<form action="/login.php"><input name="username"><input type="password" name="password"></form>';
  const requests = [];
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const scenario = url.searchParams.get('case');
    requests.push({ path: url.pathname, scenario, id: url.searchParams.get('id'),
      cookie: request.headers.cookie, method: request.method });
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/my.php') {
      response.end(scenario === 'missing-id' ? '<nav><a href="/userdetails.php?id=999">Other member</a></nav>'
        : scenario?.startsWith('main-') ? navigation + profile({ uploaded: '3 GB', downloaded: '1 GB' })
          : scenario === 'primary-login' ? login + navigation : navigation);
    } else if (url.pathname === '/userdetails.php') {
      if (scenario === 'private' || scenario === 'main-private') {
        response.writeHead(302, { Location: '/login.php' });
        response.end();
      } else if (scenario === 'unavailable' || scenario === 'main-unavailable') {
        response.writeHead(503);
        response.end('Profile unavailable');
      } else if (scenario === 'network') {
        request.socket.destroy();
      } else if (scenario === 'empty' || scenario === 'main-empty') {
        response.end('<h1>Profile has no visible statistics</h1>');
      } else if (scenario === 'challenge' || scenario === 'main-challenge') {
        response.end('<title>Just a moment...</title>' + profile({ uploaded: '999 GB' }));
      } else if (scenario === 'zero-only') {
        response.end(profile({ downloaded: '', rank: '' }));
      } else {
        response.end(profile());
      }
    } else if (url.pathname === '/login.php') {
      // A login response with stat-like promotional markup must never supply account stats.
      response.end(login + profile({ uploaded: '999 GB', downloaded: '888 GB', rank: 'Public example' }));
    } else if (url.pathname === '/unread') {
      response.end('{"unread":0}');
    } else {
      response.end('Fixture is reachable');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const fields = {
    uploadedBytes: { regex: 'Uploaded:</td><td>(?<value>[^<]+)</td>', transform: 'bytesBinary' },
    downloadedBytes: { regex: 'Downloaded:</td><td>(?<value>[^<]+)</td>', transform: 'bytesBinary' },
    memberClass: { regex: 'Class:</td><td>(?<value>[^<]+)</td>', transform: 'string' },
  };
  const trackerFor = scenario => ({
    id: `profile-${scenario}`, name: `Profile ${scenario}`, baseUrl,
    login: { url: '/login.php', cookieOnly: true, body: {}, failurePatterns: ['name="password"'] },
    fetch: { url: `/my.php?case=${scenario}`, mode: 'http', responseType: 'html', fields,
      extraFetch: {
        url: `/userdetails.php?id={{id}}&case=${scenario}`,
        idExtract: { regex: 'href="/userdetails\\.php\\?id=(?<value>\\d+)" class="my-profile"' },
        field: 'uploadedBytes', ...fields.uploadedBytes,
        extraFields: { downloadedBytes: fields.downloadedBytes, memberClass: fields.memberClass },
      } },
    dashboard: { byteUnit: 'decimal' },
  });
  const run = async tracker => {
    db.saveTrackerConfig(tracker);
    db.setTrackerCookie(tracker.id, 'fixture_session=synthetic');
    return fetchTracker(tracker, { username: 'synthetic-member', password: 'unused' });
  };
  const success = await run(trackerFor('success'));
  assert.equal(success.status, 'ok', success.error);
  assert.deepEqual(success.fields, { uploadedBytes: 0, downloadedBytes: 2 * 1024 ** 3, memberClass: 'Fixture Member' });
  assert.equal(success.byteUnit, 'binary');
  assert.equal(db.loadRawTrackerConfigsFromDb().find(tracker => tracker.id === success.id).dashboard.byteUnit, 'binary');
  assert.deepEqual(requests.filter(request => request.scenario === 'success').map(({ path, id }) => ({ path, id })), [
    { path: '/my.php', id: null }, { path: '/userdetails.php', id: '734' },
  ], 'The profile ID must come from the authenticated landing page');
  const zeroOnly = await run(trackerFor('zero-only'));
  assert.equal(zeroOnly.status, 'ok', zeroOnly.error);
  assert.deepEqual(zeroOnly.fields, { uploadedBytes: 0, downloadedBytes: '', memberClass: '' },
    'A genuine zero is sufficient; absent fields must not become invented stats');

  for (const scenario of ['missing-id', 'empty', 'unavailable', 'network', 'private', 'challenge']) {
    const result = await run(trackerFor(scenario));
    assert.equal(result.status, 'error', scenario);
    assert.match(result.error, /Aucune donnee extraite/, scenario);
    assert.deepEqual(result.fields, {}, scenario);
  }
  assert.equal(requests.filter(request => request.scenario === 'missing-id' && request.path === '/userdetails.php').length, 0,
    'Without an own-profile ID no profile request should be sent');
  for (const scenario of ['main-empty', 'main-unavailable', 'main-private', 'main-challenge']) {
    const result = await run(trackerFor(scenario));
    assert.equal(result.status, 'ok', result.error);
    assert.deepEqual(result.fields, { uploadedBytes: 3 * 1024 ** 3, downloadedBytes: 1024 ** 3, memberClass: 'Fixture Member' },
      'A failed optional profile must preserve valid landing-page stats');
  }
  const withoutExtra = trackerFor('no-secondary');
  delete withoutExtra.fetch.extraFetch;
  assert.equal((await run(withoutExtra)).status, 'error', 'An empty main response still fails without extraFetch');
  const unreadOnly = trackerFor('empty');
  unreadOnly.id = 'profile-unread-only';
  unreadOnly.fetch.unreadFetch = { url: '/unread', responseType: 'json', path: 'unread', transform: 'integer' };
  assert.equal((await run(unreadOnly)).status, 'error', 'An unrelated zero unread count cannot rescue an empty profile');
  assert.equal(requests.filter(request => request.path === '/unread').length, 0);
  const primaryLogin = await run(trackerFor('primary-login'));
  assert.equal(primaryLogin.status, 'error');
  assert.match(primaryLogin.error, /cookie refuse/);
  assert.equal(requests.filter(request => request.scenario === 'primary-login' && request.path === '/userdetails.php').length, 0,
    'A rejected primary session must never be rescued by a profile');
  assert.ok(requests.every(request => ['GET', 'HEAD'].includes(request.method)), 'No login should be submitted');
  assert.ok(requests.filter(request => ['/my.php', '/userdetails.php'].includes(request.path))
    .every(request => request.cookie === 'fixture_session=synthetic'), 'Both pages must use the same synthetic session');
  console.log('Profile-only stats OK: authenticated profile ID, zero bytes, absent data, redirects/challenges, failed secondary requests and main-stat regressions.');
} finally {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  sqlite?.close();
  process.chdir(originalCwd);
  if (originalBrowserRuntimeUrl === undefined) delete process.env.BROWSER_RUNTIME_URL;
  else process.env.BROWSER_RUNTIME_URL = originalBrowserRuntimeUrl;
  assert.equal(path.dirname(path.resolve(temp)), tempParent);
  assert.ok(path.basename(temp).startsWith('tracker-dashboard-profile-only-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
