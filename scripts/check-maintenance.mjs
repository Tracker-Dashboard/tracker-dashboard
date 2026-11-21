import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

// Détection des pages de maintenance (texte visible), ping d'un site local qui
// sert une maintenance, et place de la maintenance dans les notifications.
const originalCwd = process.cwd();
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tracker-dashboard-maintenance-'));
let server;

try {
  process.chdir(temp);
  const { isMaintenancePage, pingTracker } = await import('../dist/fetcher.js');

  // 1) Texte visible uniquement.
  const page = body => `<!doctype html><html><head><title>Tracker</title></head><body>${body}</body></html>`;
  assert.equal(isMaintenancePage(page('<h1>Site en cours de maintenance</h1><p>Revenez bientôt.</p>')), true);
  assert.equal(isMaintenancePage(page('<h1>We&#39;ll be back soon!</h1>')), true);
  assert.equal(isMaintenancePage(page('<div>SCHEDULED MAINTENANCE</div>')), true);
  assert.equal(isMaintenancePage(page('<form><input name="username"><input type="password"></form>')), false);
  assert.equal(isMaintenancePage(page('<script>window.MaintenanceCheck = () => "maintenance";</script><p>Connexion</p>')), false,
    'Un nom de composant dans un script ne compte pas');
  assert.equal(isMaintenancePage(page('<style>.maintenance{display:none}</style><a class="maintenance" href="/maintenance">Accueil</a>')), false,
    'Un nom de classe, un lien ou une règle CSS ne comptent pas');
  assert.equal(isMaintenancePage(page('<title>Just a moment...</title><p>maintenance</p>')), false,
    'Un challenge Cloudflare n\'est pas une maintenance');
  assert.equal(isMaintenancePage(''), false);

  // 2) Ping d'un site local : classement HTTP inchangé, maintenance ajoutée.
  const routes = {
    '/maint503': { status: 503, body: page('<h1>Maintenance en cours</h1>') },
    '/maint200': { status: 200, body: page('<h1>Le site est temporairement indisponible</h1>') },
    '/ok': { status: 200, body: page('<form><input name="username"></form>') },
    '/down': { status: 502, body: page('<h1>Bad gateway</h1>') },
  };
  server = http.createServer((req, res) => {
    const route = routes[req.url] ?? { status: 404, body: '' };
    res.writeHead(route.status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : route.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ping = route => pingTracker({ id: 'maint-test', name: 'Test', baseUrl: `${base}${route}` });

  assert.deepEqual(await ping('/maint503'), { reachable: false, reason: 'http_5xx', statusCode: 503, maintenance: true });
  assert.deepEqual(await ping('/maint200'), { reachable: true, statusCode: 200, maintenance: true });
  assert.deepEqual(await ping('/ok'), { reachable: true, statusCode: 200 });
  assert.deepEqual(await ping('/down'), { reachable: false, reason: 'http_5xx', statusCode: 502 });
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  process.chdir(originalCwd);
  fs.rmSync(temp, { recursive: true, force: true });
}

// 3) Notifications : maintenance jamais seule, ajoutée à un envoi existant,
// hors du compte des échecs.
const source = fs.readFileSync(new URL('../dist/server.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `bloc introuvable : ${start}`);
  return source.slice(from, to);
}
const sent = [];
const context = {
  t: value => value, serverLanguage: () => 'fr', console,
  sendBetaNotification: async (target, message, title) => sent.push({ message, title }),
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
const maint = id => ({ id, name: id, status: 'error', error: 'Extraction impossible', fields: {},
  siteReachability: { reachable: false, reason: 'http_5xx', statusCode: 503, maintenance: true } });
const failed = id => ({ id, name: id, status: 'error', error: 'Extraction impossible', fields: {},
  siteReachability: { reachable: false, reason: 'network' } });
const okStat = id => ({ id, name: id, status: 'ok', fields: {} });
async function run(results, prefs = {}, trackerAlerts = {}) {
  sent.length = 0;
  await context.notifyScheduledResult({
    notificationTargets: [{ id: 'n', enabled: true, url: 'https://example.org' }],
    notificationPreferences: { ...config, ...prefs }, globalAlerts: { ...config, ...prefs },
    trackerAlerts,
  }, results, new Set(), false);
  return sent.map(item => ({ title: item.title, message: item.message }));
}

assert.deepEqual(await run([maint('M')]), [], 'Une maintenance seule ne notifie pas');
assert.deepEqual(await run([maint('M'), okStat('A')]), [], 'Ni avec un succès non notifié');
assert.deepEqual(await run([maint('M'), failed('E')]), [{
  title: 'TD : 1 échec',
  message: '- E : Extraction impossible\n\nEn maintenance : M',
}]);
assert.deepEqual(await run([maint('M'), okStat('A')], { notifySuccess: true }), [{
  title: 'TD : 1 succès',
  message: '- A\n\nEn maintenance : M',
}]);
assert.deepEqual(await run([maint('M'), failed('E')], { notifyError: false, notifySuccess: true }), [],
  'Échecs désactivés : ni échec ni maintenance');
assert.deepEqual(await run([maint('M')], { notifyError: false }, { M: { ...config, notifyError: true } }), [],
  'Notification par tracker : la maintenance ne déclenche pas d\'envoi');

console.log('Maintenance checks OK: visible text, ping classification, notification placement.');
