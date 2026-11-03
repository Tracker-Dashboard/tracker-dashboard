import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractExtraFieldResponse } from '../dist/fetcher.js';

const tracker = JSON.parse(fs.readFileSync(new URL('../config/trackers/newasgard.json', import.meta.url), 'utf8'));
const extract = html => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
  field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
]));
const loginDetected = html => tracker.login.failurePatterns.some(pattern => html.toLowerCase().includes(pattern.toLowerCase()));

// Markup verified on New-Asgard's account header; all account data below is synthetic.
const header = (uploaded = '125.00 GB', downloaded = '25.00 GB', ratio = '5.00') => `
  <span class="navbar-text"><a href="/torrents/user/fixture-user/seeding"><i class="bi bi-arrow-up-circle text-success"></i> ${uploaded}</a></span>
  <span class="navbar-text">&nbsp;<a href="/torrents/user/fixture-user/leeching"><i class="bi bi-arrow-down-circle text-danger"></i> ${downloaded}</a></span>
  <span class="navbar-text ">&nbsp;RATIO : ${ratio}</span>`;

assert.deepEqual(extract(header()), {
  uploadedBytes: 125_000_000_000,
  downloadedBytes: 25_000_000_000,
  ratio: 5,
});
assert.equal(extract(header('1 GB', '0 GB', '12,345,678,900.00')).ratio, 12_345_678_900);
assert.deepEqual(extract(header('1,234.50 GB', '500.00 GB', '2.469')), {
  uploadedBytes: 1_234_500_000_000,
  downloadedBytes: 500_000_000_000,
  ratio: 2.469,
});
assert.deepEqual(extract(header('0 B', '0.00 GB', '0.00')), {
  uploadedBytes: 0,
  downloadedBytes: 0,
  ratio: 0,
});
assert.deepEqual(extract(header('1.5&nbsp;GiB', '2&#160;MiB', '∞').replaceAll('"', "'")), {
  uploadedBytes: 1.5 * 1024 ** 3,
  downloadedBytes: 2 * 1024 ** 2,
  ratio: '∞',
});
for (const infinity of ['inf', 'Infinite', 'Infinity']) {
  assert.equal(extract(header('1 GB', '0 GB', infinity)).ratio, '∞');
}

const emptyStats = { uploadedBytes: undefined, downloadedBytes: undefined, ratio: undefined };
const globalStats = `<section><h2>Statistiques</h2><p>Seeders : 12345</p><p>Leechers : 678</p>
  <p>Upload : 999 TB</p><p>Download : 555 TB</p><span>RATIO : 1.80</span></section>`;
assert.deepEqual(extract(globalStats), emptyStats, 'Global site counters must never become account statistics');
assert.deepEqual(extract(header('', '', '') + globalStats), emptyStats, 'Missing values must not cross into later elements');
assert.deepEqual(extract(header('25', '12', '---')), emptyStats, 'Account links without byte units are not traffic totals');
assert.deepEqual(extract(header('', '2 GB', '3.00')), {
  uploadedBytes: undefined,
  downloadedBytes: 2_000_000_000,
  ratio: 3,
}, 'A missing upload must not capture the following download');

const login = `<form method="post" action="login">
  <input type="hidden" name="redirect" value="/">
  <input type="hidden" name="_token" value="fixture-csrf-token">
  <input name="username"><input name="password" type="password">
  <input name="remember" type="checkbox"></form>`;
const csrfRegex = new RegExp(tracker.login.preStep.extract._csrf.regex, 's');
for (const page of [login, login.replaceAll('"', "'"), login.replace('name="_token" value="fixture-csrf-token"', 'value="fixture-csrf-token" name="_token"')]) {
  assert.equal(csrfRegex.exec(page)?.groups?.value, 'fixture-csrf-token');
  assert.ok(loginDetected(page), 'The login page must be recognized as an expired or failed session');
  assert.deepEqual(extract(page + globalStats), emptyStats);
}
assert.equal(csrfRegex.exec('<input type="hidden" name="redirect" value="/">'), null);
assert.equal(tracker.login.preStep.includeHiddenInputs, true);
assert.deepEqual(tracker.login.body, {
  _token: '{{_csrf}}', username: '{{username}}', password: '{{password}}',
});
assert.ok(!loginDetected(header()), 'An authenticated header must not be rejected');
assert.equal(tracker.enabled, false);
assert.equal(tracker.dashboard.byteUnit, 'decimal');

console.log('New-Asgard extraction OK: account traffic, grouped numbers, empty values, CSRF and expired sessions.');
