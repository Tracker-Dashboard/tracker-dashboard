import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const raw = JSON.parse(fs.readFileSync(new URL('../config/trackers/nirvana.json', import.meta.url), 'utf8'));
const originalCwd = process.cwd();
const originalBrowserRuntimeUrl = process.env.BROWSER_RUNTIME_URL;
const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'tracker-dashboard-nirvana-'));
let sqlite;
let server;

try {
  process.chdir(temp);
  process.env.BROWSER_RUNTIME_URL = 'disabled:';
  const db = await import('../dist/db.js');
  const { applyEnginePreset } = await import('../dist/trackerTemplates.js');
  const { extractExtraFieldResponse, fetchExtraField, fetchTracker } = await import('../dist/fetcher.js');
  sqlite = db.getDb();
  db.setJsonSetting('fast_fetch', false);
  const tracker = applyEnginePreset(raw);
  const extra = tracker.fetch.extraFetch;
  const extract = html => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
    field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
  ]));

  // Browser-verified structure; all usernames, ranks and account totals are synthetic.
  const ownLink = (className = 'top-nav__username--highresolution', href = 'https://nirvana.li/users/fixture-member') =>
    `<a class="${className}" href="${href}"><span class="text-bold"><i class="fas fa-user"></i>fixture-member</span></a>`;
  const header = '<ul class="top-nav__ratio-bar">' + [
    ['uploaded', 'Загрузить', '64&nbsp;GiB'], ['downloaded', 'Скачать', '2&nbsp;GiB'],
    ['seeding', 'Раздаётся', '7'], ['leeching', 'Скачивается', '3'],
    ['buffer', 'Буфер', '62&nbsp;GiB'], ['points', 'Мои бонусы', '3\u202f456'],
    ['ratio', 'Рейтинг', '32'], ['tokens', 'Мои FL-токены', '4'],
  ].map(([name, title, value]) => `<li class="ratio-bar__${name}" title="${title}">
    <a href="https://nirvana.li/users/fixture-member"><i class="fas fa-star"></i>${value}</a></li>`).join('') + '</ul>';
  const mailbox = '<a class="top-nav--right__icon-link" href="https://nirvana.li/users/fixture-member/conversations" title="Входящие">'
    + '<i class="fas fa-envelope"></i></a>';
  const expectedHeader = { uploadedBytes: 64 * 1024 ** 3, downloadedBytes: 2 * 1024 ** 3, ratio: 32,
    seeding: 7, leeching: 3, seedBonus: '3\u202f456', bufferBytes: 62 * 1024 ** 3, tokens: 4, unreadMessages: undefined };
  assert.deepEqual(extract(header + ownLink() + mailbox), expectedHeader);
  assert.deepEqual(extract((header + mailbox).replaceAll('"', "'").replaceAll('&nbsp;', '&#160;')), expectedHeader);
  assert.equal(raw.engine, 'unit3d');
  assert.equal(raw.enabled, false);
  assert.equal(raw.fetch.fields, undefined, 'Header extractors must remain inherited');
  assert.equal(db.effectiveStatSource(tracker), 'scrape', 'No API key is required for these profile fields');

  const classHtml = (rank = 'Fixture Member') => `<span class="user-tag profile__username" style="background-image: none;">`
    + `<a class="user-tag__link fas fa-solid fa-user" href="https://nirvana.li/users/fixture-member" style="color: #FFE7D7" title="${rank}">fixture-member</a>`
    + '<i title="Online"></i><img title="Country flag"></span>';
  const warnings = ({ active = '2', historical = '7' } = {}) => `<section class="panelV2">
    <h2 class="panel__heading">Предупреждения</h2><dl class="key-value">
    <div class="key-value__group"><dt>Активных предупреждений</dt><dd>${active}</dd></div>
    <div class="key-value__group"><dt>H&amp;R (за всё время)</dt><dd>${historical}</dd></div></dl></section>`;
  const profile = classHtml() + warnings();
  const englishProfile = profile.replace('Предупреждения', 'Warnings')
    .replace('Активных предупреждений', 'Active warnings')
    .replace('H&amp;R (за всё время)', 'Hit and run count (all time)');

  // UNIT3D UserResource.hit_and_runs and the profile H&R row both use user.hitandruns.
  // Active warnings use active_warnings_count and are a distinct value.
  // https://github.com/HDInnovations/UNIT3D/blob/master/app/Http/Resources/UserResource.php
  // https://github.com/HDInnovations/UNIT3D/blob/master/resources/views/user/profile/show.blade.php
  // AutoWarning increments hitandruns; AutoDeactivateWarning clears warning.active only.
  // https://github.com/HDInnovations/UNIT3D/blob/master/app/Console/Commands/AutoWarning.php
  // https://github.com/HDInnovations/UNIT3D/blob/master/app/Console/Commands/AutoDeactivateWarning.php
  // The class title is user.group.name, not the appended online/donor/flag icon title.
  // https://github.com/HDInnovations/UNIT3D/blob/master/resources/views/components/user-tag.blade.php
  // Official English labels support the account's language choice without changing it.
  // https://github.com/HDInnovations/UNIT3D/blob/master/lang/en/user.php
  // https://github.com/HDInnovations/UNIT3D/blob/master/lang/en/common.php
  for (const html of [profile, englishProfile, profile.replaceAll('"', "'").replaceAll('&amp;', '&')]) {
    assert.deepEqual(extractExtraFieldResponse(extra, html), { field: 'memberClass', value: 'Fixture Member', extras: { hitAndRuns: 7 } });
  }
  assert.deepEqual(extractExtraFieldResponse(extra, classHtml() + warnings({ active: '99', historical: '0' })),
    { field: 'memberClass', value: 'Fixture Member', extras: { hitAndRuns: 0 } }, 'Historical zero must not capture active warnings');
  assert.deepEqual(extractExtraFieldResponse(extra, warnings()), { field: 'hitAndRuns', value: 7 }, 'Class and H&R are independent');
  assert.deepEqual(extractExtraFieldResponse(extra, classHtml() + warnings({ historical: '' })),
    { field: 'memberClass', value: 'Fixture Member' }, 'Missing historical H&R is not zero or the active warning count');
  assert.equal(extractExtraFieldResponse(extra, warnings().replace('H&amp;R (за всё время)', 'Активных предупреждений')), null);
  assert.deepEqual(extractExtraFieldResponse(extra, englishProfile.replace('Hit and run count (all time)', 'Active warnings')),
    { field: 'memberClass', value: 'Fixture Member' }, 'English active warnings are not lifetime H&R');
  assert.equal(extractExtraFieldResponse(extra, warnings().replace('Предупреждения', 'Другие данные')), null);
  assert.equal(extractExtraFieldResponse(extra, warnings({ historical: '1,234' })), null, 'Do not partially parse a grouped integer');
  assert.equal(extractExtraFieldResponse(extra, classHtml().replace(' title="Fixture Member"', '')), null,
    'Missing class must not capture an online or flag tooltip');
  assert.equal(extractExtraFieldResponse(extra, classHtml('')), null);
  const unrelatedClass = classHtml('Other Member').replace('profile__username', 'comment__username');
  assert.equal(extractExtraFieldResponse(extra, unrelatedClass), null);
  assert.equal(extractExtraFieldResponse(extra, '<span class="user-tag profile__username"></span>' + unrelatedClass), null);
  assert.equal(extractExtraFieldResponse(extra, warnings({ historical: '' }) + '<dl><dt>H&amp;R (за всё время)</dt><dd>999</dd></dl>'), null);

  for (const nav of [ownLink(), ownLink('top-nav__username'), ownLink().replaceAll('"', "'"),
    ownLink('top-nav__username', '/users/fixture-member')]) {
    let requested;
    const result = await fetchExtraField(tracker, '<a href="https://nirvana.li/users/other-member">Other member</a>' + header + nav,
      async url => { requested = url; return { status: 200, body: profile }; }, {},
      { username: 'different-login-name', password: 'unused' });
    assert.equal(requested, 'https://nirvana.li/users/fixture-member', 'Only the own navbar link selects the profile');
    assert.equal(result.extras.hitAndRuns, 7);
  }
  for (const nav of [header, ownLink('top-nav__username-other'), ownLink('top-nav__username', 'https://other.example/users/other-member'),
    ownLink('top-nav__username', 'https://nirvana.li/users/other-member/uploads'), '<form><input type="password"></form>']) {
    let requested = false;
    assert.equal(await fetchExtraField(tracker, nav, async () => { requested = true; return null; }, {},
      { username: 'fixture-member', password: 'unused' }), null);
    assert.equal(requested, false);
  }

  // Real production HTTP path with a synthetic cookie, no credentials or API key.
  let scenario = 'success';
  const requests = [];
  server = http.createServer((request, response) => {
    requests.push({ url: request.url, method: request.method, cookie: request.headers.cookie });
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/users/fixture-member') {
      if (scenario === 'unavailable') response.statusCode = 503;
      response.end(scenario === 'login' ? '<form class="auth-form__form"><input type="password"></form>' + profile
        : scenario === 'absent' ? '<p>Private profile</p>' : profile);
    } else response.end(header + (scenario === 'missing-link' ? '' : ownLink()) + mailbox);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  for (scenario of ['success', 'absent', 'unavailable', 'login', 'missing-link']) {
    const local = { ...tracker, id: `nirvana-fixture-${scenario}`, baseUrl: `http://127.0.0.1:${server.address().port}`,
      login: { ...tracker.login, cookieOnly: true }, fetch: { ...tracker.fetch, mode: 'http' } };
    db.setTrackerCookie(local.id, 'fixture_session=synthetic');
    const before = requests.length;
    const result = await fetchTracker(local, { username: 'different-login-name', password: 'unused' });
    assert.equal(result.status, 'ok', result.error);
    const expected = { ...expectedHeader, unreadMessages: '' };
    if (scenario === 'success') Object.assign(expected, { memberClass: 'Fixture Member', hitAndRuns: 7 });
    assert.deepEqual(result.fields, expected);
    assert.equal(result.byteUnit, 'binary');
    assert.deepEqual(requests.slice(before).map(request => request.url),
      scenario === 'missing-link' ? ['/'] : ['/', '/users/fixture-member']);
  }
  assert.ok(requests.every(request => request.method === 'GET' && request.cookie === 'fixture_session=synthetic'));
  console.log('Nirvana OK: UNIT3D header, own-profile selection, member class, lifetime H&R distinct from active warnings, and no-API-key HTTP extraction.');
} finally {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  sqlite?.close();
  process.chdir(originalCwd);
  if (originalBrowserRuntimeUrl === undefined) delete process.env.BROWSER_RUNTIME_URL;
  else process.env.BROWSER_RUNTIME_URL = originalBrowserRuntimeUrl;
  assert.equal(path.dirname(path.resolve(temp)), tempParent);
  assert.ok(path.basename(temp).startsWith('tracker-dashboard-nirvana-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
