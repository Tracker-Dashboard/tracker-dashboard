import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tracker = JSON.parse(fs.readFileSync(new URL('../config/trackers/yggrasil.json', import.meta.url), 'utf8'));
const originalCwd = process.cwd();
const tempParent = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempParent, 'tracker-dashboard-draupnirr-'));

try {
  process.chdir(temp);
  const { extractExtraFieldResponse } = await import('../dist/fetcher.js');
  const extract = html => Object.fromEntries(Object.entries(tracker.fetch.fields).map(([field, extractor]) => [
    field, extractExtraFieldResponse({ field, ...extractor }, html)?.value,
  ]));
  // Synthetic profile values. "Temps de seed" is a duration, never a torrent count.
  const durationCard = duration => `<span class="lbl">Temps de seed</span><div class="val">${duration}</div>`;
  const profile = duration => `<title>Profil — Draupnirr</title>
    <span class="lbl">Uploadé</span><div class="val">12.34 GB</div>
    <span class="lbl">Téléchargé</span><div class="val">2.00 GB</div>
    <span class="lbl">Ratio</span><div class="val good">6.17</div>${durationCard(duration)}`;
  for (const duration of ['123 h', '0 h', '1,234.5 h', '—', '']) {
    const values = extract(profile(duration));
    assert.equal(values.seeding, undefined, 'A seed duration must not populate the seeding torrent count');
    assert.deepEqual(values, { uploadedBytes: 12_340_000_000, downloadedBytes: 2_000_000_000, ratio: 6.17 });
    assert.ok(Object.values(extract(durationCard(duration))).every(value => value === undefined),
      'A duration-only profile must not fabricate account statistics');
  }
  assert.deepEqual(extract('<span class="lbl">Uploadé</span><div class="val">0 B</div>'), {
    uploadedBytes: 0, downloadedBytes: undefined, ratio: undefined,
  });
  console.log('Draupnirr extraction OK: seed duration is omitted, traffic and ratio remain intact.');
} finally {
  process.chdir(originalCwd);
  assert.equal(path.dirname(path.resolve(temp)), tempParent);
  assert.ok(path.basename(temp).startsWith('tracker-dashboard-draupnirr-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
