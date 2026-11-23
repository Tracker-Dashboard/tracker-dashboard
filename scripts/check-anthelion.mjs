import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const raw = JSON.parse(fs.readFileSync(new URL('../config/trackers/anthelion.json', import.meta.url), 'utf8'));
const originalCwd = process.cwd();
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tracker-dashboard-anthelion-'));

try {
  // Import only after isolating cwd, so the production extractor cannot open a real account database.
  process.chdir(temp);
  const { extractExtraFieldResponse } = await import('../dist/fetcher.js');
  const { applyEnginePreset } = await import('../dist/trackerTemplates.js');
  const tracker = applyEnginePreset(raw);
  const extract = html => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
    field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
  ]));

  // Login form verified on anthelion.me/login.php: username, password, twofa (TOTP) on the same page.
  assert.equal(tracker.login.url, 'login.php');
  assert.equal(tracker.login.otpField, 'twofa');
  assert.equal(tracker.login.body.username, '{{username}}');
  assert.equal(tracker.login.body.password, '{{password}}');
  // The seeding count is in the header; the member class is only on the profile page.
  const profile = tracker.fetch.extraFetch;
  assert.equal(profile.field, 'memberClass');
  assert.equal(profile.url, 'user.php?id={{id}}');
  const headerUser = '<li id="nav_user" class="nav_dropdown"><a href="user.php?id=12345" class="username">synthetic-member</a>';
  assert.equal(new RegExp(profile.idExtract.regex).exec(headerUser)?.groups?.value, '12345');
  for (const [markup, expected] of [
    ['<ul class="stats nobullet"><li>Joined: 1 year ago</li><li>Class: User</li></ul>', 'User'],
    ['<li>Class: <span class="userclass">Power User</span></li>', 'Power User'],
  ]) {
    assert.equal(extractExtraFieldResponse(profile, markup)?.value, expected);
  }

  // Header structure verified from sanitized markup; every account value here is synthetic.
  const header = ({ seeding = '1,204', leeching = '2', up = '1.23 TiB', down = '512.00 GiB',
    ratio = '<span class="tooltip r20" title="2.46">2.46</span>', tokens = '3', orbs = '12,345' } = {}) => `
    <ul id="userinfo_stats">
      <li id="stats_seeding">
        <a href="torrents.php?type=seeding&amp;userid=1">Seeding</a>:
        <span class="stat user_commstats" id="header_user_commstats_seeding">${seeding}</span>
      </li>
      <li id="stats_leeching">
        <a href="torrents.php?type=leeching&amp;userid=1">Leeching</a>:
        <span class="stat user_commstats" id="header_user_commstats_leeching">${leeching}</span>
      </li>
      <li id="stats_uploaded">
        <a href="torrents.php?type=seeding&amp;userid=1">Up</a>:
        <span class="stat tooltip tooltipstered">${up}</span>
      </li>
      <li id="stats_downloaded">
        <a href="torrents.php?type=downloaded&amp;userid=1">Down</a>:
        <span class="stat tooltip tooltipstered">${down}</span>
      </li>
      <li id="stats_ratio">
        Ratio: <span class="stat">${ratio}</span>
      </li>
      <li id="fl_tokens">
        <a href="wiki.php?action=article&amp;name=tokens">Tokens</a>:
        <span class="stat">
          <a href="userhistory.php?action=token_history&amp;userid=1">${tokens}</a>
        </span>
      </li>
      <li id="bonus_points">
        <a href="wiki.php?action=article&amp;name=bonuspoints">Orbs</a>:
        <span class="stat">
          <a href="store.php">${orbs}</a>
        </span>
      </li>
    </ul>`;

  assert.deepEqual(extract(header()), {
    uploadedBytes: Math.round(1.23 * 1024 ** 4),
    downloadedBytes: 512 * 1024 ** 3,
    ratio: 2.46,
    memberClass: undefined,
    seeding: 1204,
    leeching: 2,
    tokens: 3,
    seedBonus: '12,345',
  });
  assert.deepEqual(extract(header({ seeding: '6', leeching: '0', up: '0.00 B', down: '0.00 B', ratio: '0.0', tokens: '10', orbs: '63' })), {
    uploadedBytes: 0, downloadedBytes: 0, ratio: 0, memberClass: undefined,
    seeding: 6, leeching: 0, tokens: 10, seedBonus: '63',
  });
  assert.equal(extract(header({ ratio: '<span class="r99">∞</span>' })).ratio, '∞');
  assert.equal(extract(header({ up: '987.65 MiB' })).uploadedBytes, Math.round(987.65 * 1024 ** 2));

  // Without the header (login page served instead of the home page), nothing is read.
  assert.ok(Object.values(extract('<form id="loginform"><input name="twofa"></form>')).every(value => value === undefined));

  console.log('Anthelion OK: login 2FA (twofa), header stats, member class from the profile, thousands separators in counters.');
} finally {
  process.chdir(originalCwd);
  fs.rmSync(temp, { recursive: true, force: true });
}
