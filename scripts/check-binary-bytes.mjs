import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'tracker-dashboard-binary-bytes-'));
const originalBrowserRuntimeUrl = process.env.BROWSER_RUNTIME_URL;
let sqlite;
let server;

try {
  // Import after changing cwd so production settings, cookies and dumps stay isolated.
  process.chdir(temp);
  process.env.BROWSER_RUNTIME_URL = 'disabled:';
  const db = await import('../dist/db.js');
  const { extractExtraFieldResponse, fetchExtraField, fetchTracker, fetchApiStats } = await import('../dist/fetcher.js');
  const { sanitizeTrackerConfigInput } = await import('../dist/server.js');
  sqlite = db.getDb();
  db.setJsonSetting('fast_fetch', false);

  const htmlField = { regex: '<b>(?<value>[^<]+)</b>', transform: 'bytesBinary' };
  const extra = { url: '/extra', field: 'uploadedBytes', ...htmlField };
  const htmlValue = (value, transform = 'bytesBinary') => extractExtraFieldResponse(
    { ...extra, transform }, `<b>${value}</b>`);
  for (const [value, expected] of [
    ['0 GB', 0], ['42 B', 42], ['42', 42], ['1 KB', 1024], ['1 MB', 1024 ** 2],
    ['1 GB', 1024 ** 3], ['1 TB', 1024 ** 4], ['1 KiB', 1024], ['1 GiB', 1024 ** 3],
    ['2 Ko', 2 * 1024], ['2 Mo', 2 * 1024 ** 2], ['2 Go', 2 * 1024 ** 3],
    ['2 Kio', 2 * 1024], ['2 Gio', 2 * 1024 ** 3], ['1,5 go', 1.5 * 1024 ** 3],
    ['1,234.50 GB', 1234.5 * 1024 ** 3], ['1.234,50 GB', 1234.5 * 1024 ** 3],
    ['1\u202f234,50 Go', 1234.5 * 1024 ** 3], ['1.5&nbsp;GB', 1.5 * 1024 ** 3],
    ['1.5&#160;GB', 1.5 * 1024 ** 3], ['1.5&#xa0;GB', 1.5 * 1024 ** 3],
  ]) {
    assert.deepEqual(htmlValue(value), { field: 'uploadedBytes', value: expected, byteUnit: 'binary' }, value);
  }
  assert.equal(htmlValue(''), null, 'Absent data must not become zero');
  assert.equal(extractExtraFieldResponse(extra, '<p>No account totals</p>'), null);
  assert.deepEqual(extractExtraFieldResponse({ ...extra,
    regex: '<b>(?<value>[\\d.]+)</b>\\s*<em>(?<unit>\\w+)</em>',
  }, '<b>0</b><em>GB</em>'), { field: 'uploadedBytes', value: 0, byteUnit: 'binary' });
  assert.equal(extractExtraFieldResponse({ ...extra,
    regex: '<b>(?<value>[\\d.]+)</b>\\s*<em>(?<unit>\\w+)</em>',
  }, '<b>1.5</b><em>GB</em>').value, 1.5 * 1024 ** 3);

  const jsonExtra = { url: '/extra', field: 'uploadedBytes', path: 'stats.upload', responseType: 'json', transform: 'bytesBinary' };
  for (const value of [0, 42, 1073741824]) {
    assert.deepEqual(extractExtraFieldResponse(jsonExtra, JSON.stringify({ stats: { upload: value } })),
      { field: 'uploadedBytes', value, byteUnit: 'binary' }, 'Numeric JSON is already raw bytes');
  }
  assert.equal(extractExtraFieldResponse(jsonExtra, '{"stats":{"upload":"1 GB"}}').value, 1024 ** 3);
  for (const body of ['{}', '{"stats":{"upload":null}}', '{"stats":{"upload":""}}']) {
    assert.equal(extractExtraFieldResponse(jsonExtra, body), null);
  }

  // Existing transforms keep decimal labels and explicit IEC units unchanged.
  for (const [value, expected] of [['0 GB', 0], ['1 GB', 1e9], ['1 Go', 1e9], ['1 GiB', 1024 ** 3], ['1 Gio', 1024 ** 3]]) {
    assert.deepEqual(htmlValue(value, 'bytes'), { field: 'uploadedBytes', value: expected });
  }
  const mixedExtra = { ...extra, field: 'memberClass', regex: '<i>(?<value>[^<]+)</i>', transform: 'string',
    extraFields: { uploadedBytes: htmlField } };
  assert.deepEqual(extractExtraFieldResponse(mixedExtra, '<i>User</i><b>0 GB</b>'),
    { field: 'memberClass', value: 'User', extras: { uploadedBytes: 0 }, byteUnit: 'binary' });
  assert.deepEqual(extractExtraFieldResponse(mixedExtra, '<i>User</i>'), { field: 'memberClass', value: 'User' });
  assert.deepEqual(extractExtraFieldResponse(mixedExtra, '<b>1 GB</b>'),
    { field: 'uploadedBytes', value: 1024 ** 3, byteUnit: 'binary' });
  const merged = await fetchExtraField({ baseUrl: 'https://fixture.invalid/', fetch: { extraFetch: [extra,
    { url: '/rank', field: 'memberClass', regex: '<i>(?<value>[^<]+)</i>', transform: 'string' }] } }, '',
  async url => ({ status: 200, body: url.endsWith('/rank') ? '<i>User</i>' : '<b>1 GB</b>' }), {}, {});
  assert.deepEqual(merged, { field: 'uploadedBytes', value: 1024 ** 3, extras: { memberClass: 'User' }, byteUnit: 'binary' });

  const requests = [];
  server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    const json = request.url === '/json';
    response.writeHead(200, { 'Content-Type': json ? 'application/json' : 'text/html' });
    response.end(request.url === '/failed' ? '<form>session-expired</form>' : json
      ? JSON.stringify({ stats: { upload: 1073741824, zero: 0, labelled: '1 GB' } })
      : '<b>1 GB</b><i>User</i>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const makeTracker = (id, fetch, api) => ({ id, name: id, baseUrl,
    login: { url: '/login', cookieOnly: true, body: {}, failurePatterns: ['session-expired'] },
    fetch: { url: '/html', mode: 'http', responseType: 'html', fields: { uploadedBytes: htmlField }, ...fetch },
    dashboard: { byteUnit: 'decimal' }, ...(api ? { api } : {}) });
  const runTracker = async (tracker, expectedUnit, expectedFields) => {
    db.saveTrackerConfig(tracker);
    db.setTrackerCookie(tracker.id, 'fixture_session=synthetic');
    if (tracker.api) {
      db.setTrackerApiKey(tracker.id, 'synthetic-api-key');
      db.setTrackerStatSource(tracker.id, 'api');
    }
    const result = await fetchTracker(tracker, { username: 'fixture-user', password: 'unused' });
    assert.equal(result.status, 'ok', result.error);
    assert.equal(result.byteUnit, expectedUnit, tracker.id);
    assert.deepEqual(result.fields, expectedFields, tracker.id);
    assert.equal(db.loadRawTrackerConfigsFromDb().find(row => row.id === tracker.id).dashboard.byteUnit, expectedUnit,
      'Detected units must survive cached-stat reloads');
    return result;
  };
  await runTracker(makeTracker('binary-html'), 'binary', { uploadedBytes: 1024 ** 3 });
  await runTracker(makeTracker('decimal-html', { fields: { uploadedBytes: { ...htmlField, transform: 'bytes' } } }),
    'decimal', { uploadedBytes: 1e9 });
  await runTracker(makeTracker('binary-json', { url: '/json', responseType: 'json', fields: {
    uploadedBytes: { path: 'stats.upload', transform: 'bytesBinary' },
    downloadedBytes: { path: 'stats.zero', transform: 'bytesBinary' },
    seedingBytes: { path: 'stats.labelled', transform: 'bytesBinary' },
  } }), 'binary', { uploadedBytes: 1024 ** 3, downloadedBytes: 0, seedingBytes: 1024 ** 3 });
  await runTracker(makeTracker('missing-binary', { fields: {
    uploadedBytes: { ...htmlField, transform: 'bytes' },
    downloadedBytes: { regex: '<missing>(?<value>[^<]+)</missing>', transform: 'bytesBinary' },
  } }), 'decimal', { uploadedBytes: 1e9, downloadedBytes: '' });
  await runTracker(makeTracker('binary-extra', { fields: {
    uploadedBytes: { ...htmlField, transform: 'bytes' },
  }, extraFetch: [{ ...extra, field: 'downloadedBytes' },
    { url: '/rank', field: 'memberClass', regex: '<i>(?<value>[^<]+)</i>', transform: 'string' }] }),
  'binary', { uploadedBytes: 1e9, downloadedBytes: 1024 ** 3, memberClass: 'User' });

  const api = { url: '/json', fields: { uploadedBytes: { path: 'stats.upload', transform: 'bytesBinary' } } };
  await runTracker(makeTracker('binary-api', { fields: { uploadedBytes: { ...htmlField, transform: 'bytes' } } }, api),
    'binary', { uploadedBytes: 1024 ** 3 });
  const fallback = await runTracker(makeTracker('binary-api-fallback', { url: '/failed' }, api),
    'binary', { uploadedBytes: 1024 ** 3 });
  assert.match(fallback.loginError, /cookie refuse/);
  const htmlApi = await fetchApiStats(makeTracker('binary-html-api', {}, { url: '/html', responseType: 'html',
    fields: { uploadedBytes: htmlField } }), 'synthetic-api-key');
  assert.deepEqual(htmlApi, { ok: true, fields: { uploadedBytes: 1024 ** 3 }, byteUnit: 'binary' });
  assert.ok(requests.every(request => ['GET', 'HEAD'].includes(request.method)), 'Fixtures must never log in');

  for (const transform of ['bytes', 'bytesBinary']) {
    for (const responseType of ['html', 'json']) {
      const tracker = makeTracker('validation-fixture', { responseType,
        fields: { uploadedBytes: { ...htmlField, path: 'stats.upload', transform } } });
      const sanitized = sanitizeTrackerConfigInput(tracker);
      assert.ok(sanitized.config, sanitized.error);
      assert.equal(sanitized.config.fetch.fields.uploadedBytes.transform, transform);
    }
  }
  console.log('Binary bytes OK: HTML/JSON/extraFetch/API, raw numeric bytes, units, zero/absent values, saved display units and decimal regression.');
} finally {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  sqlite?.close();
  process.chdir(originalCwd);
  if (originalBrowserRuntimeUrl === undefined) delete process.env.BROWSER_RUNTIME_URL;
  else process.env.BROWSER_RUNTIME_URL = originalBrowserRuntimeUrl;
  assert.equal(path.dirname(path.resolve(temp)), tempParent);
  assert.ok(path.basename(temp).startsWith('tracker-dashboard-binary-bytes-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
