import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractExtraFieldResponse, fetchExtraField } from '../dist/fetcher.js';

const tracker = JSON.parse(fs.readFileSync(new URL('../config/trackers/sportscult.json', import.meta.url), 'utf8'));
const extract = html => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
  field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
]));

// Synthetic account data using the header labels and profile cells documented by:
// https://github.com/wuyaos/pt_checkin/blob/master/src/pt_checkin/sites/sportscult.py
// https://github.com/pt-plugins/PT-Plugin-Plus/blob/dev/resource/sites/sportscult.org/config.json
const header = `<table class="lista"><tr>
  <td>Welcome back <a href="index.php?page=usercp&amp;uid=42"><b>fixture-user</b></a></td>
  <td class="green">↑ <b>1.25 TB</b></td>
  <td class="red">↓ <b>500.00 GB</b></td>
  <td>Ratio <span class="green">2.50</span></td>
  <td class="green">(Bonus <b>1,234.50</b>)</td>
</tr></table>`;
assert.deepEqual(extract(header), {
  uploadedBytes: 1_250_000_000_000,
  downloadedBytes: 500_000_000_000,
  ratio: 2.5,
  seedBonus: '1,234.50',
});

assert.deepEqual(extract('<td>&uarr;&nbsp;0 B</td><td>&darr; 0.00 GB</td><td>Ratio 0.00</td><td>(Bonus 0)</td>'), {
  uploadedBytes: 0, downloadedBytes: 0, ratio: 0, seedBonus: '0',
});
assert.equal(extract('<td>&#8593; 1&#160;GiB</td>').uploadedBytes, 1024 ** 3);
assert.equal(extract('<td>&#x2193; 2&nbsp;MiB</td>').downloadedBytes, 2 * 1024 ** 2);
assert.equal(extract('<td>Ratio <b>∞</b></td>').ratio, '∞');
// An undefined ratio must remain absent so the dashboard can derive it from UP/DL.
assert.equal(extract('<td>Ratio ---</td><td>(Bonus 25)</td>').ratio, undefined);

const profile = `<table class="lista">
  <tr><td class="header">Uploaded:</td><td class="lista">125.50 GB</td></tr>
  <tr><td class="header">Downloaded:</td><td class="lista">50.20 GB</td></tr>
  <tr><td class="header">Ratio:</td><td class="lista"><span>2.50</span></td></tr>
  <tr><td class="header">Rank:</td><td class="lista"><b>ProAthlete</b></td></tr>
</table>`;
assert.equal(extract(profile).uploadedBytes, 125_500_000_000);
assert.equal(extract(profile).downloadedBytes, 50_200_000_000);
assert.equal(extract(profile).ratio, 2.5);
assert.equal(extractExtraFieldResponse(tracker.fetch.extraFetch, profile)?.value, 'ProAthlete');
assert.equal(extractExtraFieldResponse(tracker.fetch.extraFetch, '<td>Rank:</td><td>Athlete</td>')?.value, 'Athlete');
assert.equal(extractExtraFieldResponse(tracker.fetch.extraFetch, '<td>Rank:</td><td></td><td>Uploaded:</td><td>10 GB</td>'), null);

let requestedUrl;
for (const page of [header, header.replaceAll('&amp;', '&').replaceAll('"', "'")]) {
  const result = await fetchExtraField(tracker, page, async url => {
    requestedUrl = url;
    return { status: 200, body: profile };
  }, {}, { username: 'fixture-user', password: 'unused' });
  assert.equal(requestedUrl, 'https://sportscult.org/index.php?page=usercp&uid=42');
  assert.deepEqual(result, { field: 'memberClass', value: 'ProAthlete' });
}

// The public login page contains a guest uid in JavaScript; never use it as a profile link.
const login = `<script>window.location='index.php?page=usercp&uid=1&do=pm'</script>
  Welcome Guest <form action="index.php?page=login" method="post">
  <input name="uid"><input type="password" name="pwd"></form>`;
assert.ok(tracker.login.failurePatterns.some(pattern => login.includes(pattern)));
assert.ok(!tracker.login.failurePatterns.some(pattern => header.includes(pattern)));
assert.ok(Object.values(extract(login)).every(value => value === undefined));
let guestProfileRequests = 0;
await fetchExtraField(tracker, login, async () => {
  guestProfileRequests += 1;
  return { status: 200, body: profile };
}, {}, { username: 'fixture-user', password: 'unused' });
assert.equal(guestProfileRequests, 0, 'A guest page without a profile link must not trigger a profile request');
assert.equal(await fetchExtraField(tracker, header, async () => ({ status: 200, body: login }), {}, {
  username: 'fixture-user', password: 'unused',
}), null);
assert.equal(await fetchExtraField(tracker, header, async () => ({ status: 503, body: profile }), {}, {
  username: 'fixture-user', password: 'unused',
}), null);

console.log('SportsCult extraction OK: account stats, empty values, profile link and expired session.');
