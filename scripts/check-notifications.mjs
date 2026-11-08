import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the production notification path without starting the server or contacting trackers.
const source = fs.readFileSync(new URL('../dist/server.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
const sent = [];
const context = {
  t: value => value, serverLanguage: () => 'fr', console,
  sendBetaNotification: async (target, message, title) => sent.push({ target: target.id, message, title }),
};
vm.createContext(context);
vm.runInContext([
  between('function isUnconfiguredStat(', 'function logStatResult('),
  between('function unreadMessagesCount(', 'async function runBetaScheduledCycle('),
].join('\n'), context);
const config = {
  notifyError: true, notifyManualError: true,
  notifySuccess: false, notifyManualSuccess: false,
  notifyStats: false, notifyManualStats: false,
  notifyMp: false, notifyManualMp: false,
  ratioEnabled: false, ratioThreshold: 1,
  bufferEnabled: false, bufferThresholdGo: 1,
  sessionEnabled: false, sessionDays: 30,
};
const error = id => ({ id, name: id, status: 'error', error: 'Extraction impossible', fields: {} });
const ok = { id: 'A', name: 'A', status: 'ok', fields: { ratio: 0.5, unreadMessages: 2 } };
async function run(results, global = {}, specific = {}, manual = false, targets = ['discord']) {
  sent.length = 0;
  await context.notifyScheduledResult({
    notificationTargets: targets.map(id => ({ id, enabled: true, url: 'https://example.org' })),
    notificationPreferences: { ...config, ...global }, globalAlerts: { ...config, ...global },
    trackerAlerts: Object.fromEntries(Object.entries(specific).map(([id, cfg]) => [id, { ...config, ...cfg }])),
  }, results, new Set(), manual);
  return sent;
}
for (const manual of [false, true]) {
  await run([error('A'), error('B')], {}, { A: {}, B: {} }, manual);
  assert.equal(sent.length, 1, 'identical global and tracker failures are sent once');
  assert.match(sent[0].title, /2 échecs/);
  await run([error('A'), error('B')], {}, { A: {} }, manual);
  assert.equal(sent.length, 1, 'a tracker subset must not repeat global failures');
  await run([error('A')], { notifyError: false, notifyManualError: false }, { A: {} }, manual);
  assert.equal(sent.length, 1, 'tracker-only errors remain enabled');
}
await run([error('A')], { notifyManualError: false }, { A: { notifyManualError: false } }, true);
assert.equal(sent.length, 0, 'manual preferences stay separate');
await run([ok], { notifySuccess: true }, { A: { notifySuccess: true } });
assert.equal(sent.length, 1);
await run([ok], { notifySuccess: true, notifyStats: true, notifyMp: true }, { A: { notifySuccess: true } });
assert.equal(sent.length, 1, 'a less detailed success is already covered');
for (const detail of ['notifyStats', 'notifyMp']) {
  await run([ok], { notifySuccess: true }, { A: { notifySuccess: true, [detail]: true } });
  assert.equal(sent.length, 2, 'extra tracker details must survive');
  assert.match(sent[1].message, detail === 'notifyStats' ? /Ratio 0.50/ : /2 MP/);
}
await run([ok], {}, { A: { notifySuccess: true } });
assert.equal(sent.length, 1, 'tracker-only success remains enabled');
await run([ok], { ratioEnabled: true }, { A: { ratioEnabled: true } });
assert.equal(sent.length, 1, 'identical threshold alerts are sent once');
await run([ok], { ratioEnabled: true }, { A: { ratioEnabled: true, ratioThreshold: 2 } });
assert.equal(sent.length, 2, 'distinct thresholds remain visible');
await run([error('A')], {}, { A: {} }, false, ['discord', 'apprise']);
assert.equal(sent.length, 2, 'each enabled destination receives one notification');
assert.deepEqual(sent.map(item => item.target), ['discord', 'apprise']);
await run([error('A')], {}, { A: {} });
assert.equal(sent.length, 1, 'later refreshes are not suppressed');
await run([{ ...error('A'), error: 'Credentials manquants' }], {}, { A: {} });
assert.equal(sent.length, 0, 'unconfigured trackers remain excluded');
console.log('Notification checks OK: overlapping settings, manual refreshes, extra details, thresholds and destinations.');
