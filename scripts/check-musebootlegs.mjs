import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tracker = JSON.parse(fs.readFileSync(new URL('../config/trackers/musebootlegs.json', import.meta.url), 'utf8'));
const originalCwd = process.cwd();
const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'tracker-dashboard-musebootlegs-'));

try {
  process.chdir(temp);
  const { extractExtraFieldResponse } = await import('../dist/fetcher.js');
  const extract = html => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
    field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
  ]));
  const empty = Object.fromEntries(Object.keys(tracker.fetch.fields).map(field => [field, undefined]));
  const loginDetected = html => tracker.login.failurePatterns.some(pattern => html.includes(pattern));

  // Browser-verified TSUE account block; all values below are synthetic.
  // GB uses the application's existing bytes contract. The site's server formatter
  // has not been verified, so these expectations do not establish its actual radix.
  const header = ({ uploaded = '12.50 GB', downloaded = '2.50 GB', buffer = '10 GB', ratio = '5',
    points = '1,234.50', hitAndRuns = '2', totalWarns = '19' } = {}) => `<div id="ul_dl_stats" class="small">
    <b>Uploaded:</b> ${uploaded} <br>
    <b>Downloaded:</b> ${downloaded}<br>
    <b>Buffer:</b> ${buffer}<br>
    <b>Ratio:</b> <span class="ratioNull" original-title="">${ratio}</span><br>
    <b>Max.Slots:</b> Unlimited<br>
    <b>Points:</b> <a href="https://musebootlegs.com/?p=market&amp;pid=23" original-title="">${points}</a><br>
    <b>Total Posts:</b> 999<br>
    <b>Total Invites:</b> <a href="https://musebootlegs.com/?p=membercp&amp;action=invite&amp;pid=22">83</a><br>
    <b>Total Warns:</b> <span id="total_warns" class="clickable">${totalWarns}</span><br>
    <b>Hit &amp; Run Warns:</b> <span id="hitrun_warns" class="clickable">${hitAndRuns}</span><br>
  </div>`;
  const expected = { uploadedBytes: 12_500_000_000, downloadedBytes: 2_500_000_000, bufferBytes: 10_000_000_000,
    ratio: 5, seedBonus: '1,234.50', hitAndRuns: 2 };
  for (const html of [header(), header().replaceAll('"', "'").replaceAll('&amp;', '&')]) {
    assert.deepEqual(extract(html), expected);
    assert.equal(loginDetected(html), false);
  }
  assert.deepEqual(extract(header({ uploaded: '1 GB', downloaded: '0', buffer: '1 GB', ratio: '0', points: '10', hitAndRuns: '0' })), {
    uploadedBytes: 1_000_000_000, downloadedBytes: 0, bufferBytes: 1_000_000_000, ratio: 0, seedBonus: '10', hitAndRuns: 0,
  }, 'TSUE displays zero download without a unit; retain the site ratio even at zero download');
  assert.deepEqual(extract(header({ uploaded: '0', downloaded: '0', buffer: '0', ratio: '0', points: '0', hitAndRuns: '0' })), {
    uploadedBytes: 0, downloadedBytes: 0, bufferBytes: 0, ratio: 0, seedBonus: '0', hitAndRuns: 0,
  });
  assert.deepEqual(extract(header({ uploaded: '1,234.50 GB', downloaded: '12,345.67 MB', buffer: '1.25 TB',
    ratio: '12,345.67', points: '12 345,67', hitAndRuns: '1234' })), {
    uploadedBytes: 1_234_500_000_000, downloadedBytes: 12_345_670_000, bufferBytes: 1_250_000_000_000,
    ratio: 12_345.67, seedBonus: '12 345,67', hitAndRuns: 1234,
  });
  assert.equal(extract(header({ uploaded: '1.5&nbsp;GiB' })).uploadedBytes, 1.5 * 1024 ** 3);
  assert.equal(extract(header({ downloaded: '2&#160;MiB' })).downloadedBytes, 2 * 1024 ** 2);
  for (const ratio of ['∞', 'Inf', 'Infinity']) assert.equal(extract(header({ ratio })).ratio, '∞');
  for (const [option, field] of [['uploaded', 'uploadedBytes'], ['downloaded', 'downloadedBytes'], ['buffer', 'bufferBytes'],
    ['ratio', 'ratio'], ['points', 'seedBonus'], ['hitAndRuns', 'hitAndRuns']]) {
    assert.deepEqual(extract(header({ [option]: '' })), { ...expected, [field]: undefined },
      `${field}: missing values must not use the next stat or become zero`);
  }
  for (const value of ['12', '—', '-2 GB']) {
    assert.equal(extract(header({ uploaded: value, buffer: value })).uploadedBytes, undefined);
    assert.equal(extract(header({ buffer: value })).bufferBytes, undefined);
  }
  assert.equal(extract(header({ ratio: '---' })).ratio, undefined);
  assert.equal(extract(header({ hitAndRuns: '' })).hitAndRuns, undefined, 'Total Warns is not a H&R count');
  assert.equal(extract(header({ hitAndRuns: '1,234' })).hitAndRuns, undefined,
    'An unsupported grouped count must not be truncated or interpreted as a decimal');
  assert.equal(extract(header().replace('id="hitrun_warns"', 'id="other_warns"')).hitAndRuns, undefined);
  assert.equal(extract(header().replace('Hit &amp; Run Warns:', 'Other Warns:')).hitAndRuns, undefined);
  const unrelated = header().replace('id="ul_dl_stats"', 'id="global_stats"');
  const blank = header({ uploaded: '', downloaded: '', buffer: '', ratio: '', points: '', hitAndRuns: '' });
  assert.deepEqual(extract(unrelated), empty, 'Global stats must not become account data');
  assert.deepEqual(extract(blank + unrelated), empty, 'Extraction must stop at the account block boundary');
  assert.deepEqual(extract(unrelated + header() + unrelated), expected);

  const extra = tracker.fetch.extraFetch;
  const profileLink = '<a href="https://musebootlegs.com/?p=profile&amp;pid=18&amp;memberid=42" original-title="">Profile</a>';
  const idRegex = new RegExp(extra.idExtract.regex, 's');
  const avatar = '<div class="memberCardAvatar"><img src="/styles/default/avatar.png" alt="fixture-avatar"></div>';
  const profile = rank => `<div id="memberCard">${avatar}<div class="memberCardDetails">
    <a href="/?p=profile&amp;pid=18&amp;memberid=42"><span>fixture-user</span></a>, fixture metadata<br>
    <span style="color: #ffffff; font-weight: bold;" original-title="">${rank}</span><br>
    <b>Member Since:</b> fixture date<br></div><div class="clear"></div></div>`;
  for (const link of [profileLink, profileLink.replaceAll('"', "'").replaceAll('&amp;', '&'),
    profileLink.replace('https://musebootlegs.com', '')]) {
    assert.equal(idRegex.exec(link)?.groups?.value, '42');
  }
  assert.equal(idRegex.exec(profileLink.replace('>Profile<', '>Other member<')), null);
  assert.equal(idRegex.exec(profileLink.replace('p=profile', 'p=membercp')), null);
  assert.equal(idRegex.exec(profileLink.replace('>Profile<', '>Other member<') + profileLink)?.groups?.value, '42');
  assert.equal(extra.url.replace('{{id}}', idRegex.exec(profileLink).groups.value), '/?p=profile&pid=18&memberid=42');
  for (const html of [profile('Registered Users'), profile('Registered Users').replaceAll('"', "'"),
    profile('Registered Users').replace(avatar, '')]) {
    assert.equal(extractExtraFieldResponse(extra, html)?.value, 'Registered Users');
  }
  for (const html of [profile(''), profile('Registered Users').replace('id="memberCard"', 'id="other-member"'),
    profile('Registered Users').replace('Member Since:', 'Forum title:'),
    profile('Registered Users').replace(avatar, avatar + '</div><div id="anotherCard">'),
    profile('') + profile('Administrator').replace('id="memberCard"', 'id="other-member"')]) {
    assert.equal(extractExtraFieldResponse(extra, html), null, 'Missing own-profile class must not capture names, metadata or another card');
  }

  // Public Jackett adapter documents the TSUE AJAX form and stKey token. Cookie-only
  // browser mode remains required here because the live login also meets Cloudflare.
  const login = '<form id="loginbox_form"><input name="loginbox_membername"><input type="password" name="loginbox_password"></form>';
  for (const page of [login, login.replaceAll('"', "'")]) {
    assert.equal(loginDetected(page), true);
    assert.deepEqual(extract(page + unrelated), empty);
  }
  const securityToken = new RegExp(tracker.login.preStep.extract.securitytoken.regex, 's');
  assert.equal(securityToken.exec('<script>var TSUE = { stKey: "fixture-security-token", };</script>')?.groups?.value, 'fixture-security-token');
  assert.equal(tracker.login.body.securitytoken, '{{securitytoken}}');
  assert.equal(tracker.login.postUrl, '/ajax/login.php');
  assert.equal(tracker.login.cookieOnly, true);
  assert.ok(tracker.login.cookieInstructions.includes('Cloudflare'));
  assert.equal(tracker.fetch.mode, 'browser');
  assert.equal(tracker.enabled, false);
  console.log('MuseBootlegs extraction OK: six scoped stats, bare zero traffic, grouped values, own-profile class and cookie-only login.');
} finally {
  process.chdir(originalCwd);
  assert.equal(path.dirname(path.resolve(temp)), tempParent);
  assert.ok(path.basename(temp).startsWith('tracker-dashboard-musebootlegs-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
