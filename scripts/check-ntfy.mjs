import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exécute le chemin d'envoi ntfy de production et le masquage des secrets,
// sans démarrer le serveur ni contacter de serveur ntfy.
const source = fs.readFileSync(new URL('../dist/server.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `bloc introuvable : ${start}`);
  return source.slice(from, to);
}
const posts = [];
const context = {
  Buffer,
  axios: { post: async (url, body, options) => { posts.push({ url, body, options }); return { status: 200 }; } },
};
vm.createContext(context);
vm.runInContext([
  between('function sanitizeBetaSettings(', 'function saveBetaSettingsPayload('),
  between('async function sendBetaNotification(', 'export async function start('),
  'this.sanitizeBetaSettings = sanitizeBetaSettings; this.sendBetaNotification = sendBetaNotification;',
].join('\n'), context);

const base = { id: 'n', type: 'ntfy', label: 'ntfy', url: 'https://ntfy.example.org/', ntfyTopic: 'td', enabled: true };

// Publication JSON sur la racine, valeurs par défaut, titre accentué intact.
posts.length = 0;
await context.sendBetaNotification(base, '- A : Extraction impossible', 'TD : 2 échecs');
assert.equal(posts.length, 1);
assert.equal(posts[0].url, 'https://ntfy.example.org/');
assert.deepEqual({ ...posts[0].body, tags: [...posts[0].body.tags] }, {
  topic: 'td', title: 'TD : 2 échecs', message: '- A : Extraction impossible', priority: 4, tags: ['warning'],
});
assert.equal(posts[0].options.headers.Authorization, undefined);

// Basic : identifiant + mot de passe.
posts.length = 0;
await context.sendBetaNotification({ ...base, ntfyUser: 'u', ntfyPass: 'p', ntfyPriority: 2, ntfyTags: ['tada'] }, 'm', 't');
assert.equal(posts[0].options.headers.Authorization, `Basic ${Buffer.from('u:p').toString('base64')}`);
assert.equal(posts[0].body.priority, 2);
assert.deepEqual([...posts[0].body.tags], ['tada']);

// Jeton prioritaire sur Basic.
posts.length = 0;
await context.sendBetaNotification({ ...base, ntfyUser: 'u', ntfyPass: 'p', ntfyToken: 'tk_abc' }, 'm', 't');
assert.equal(posts[0].options.headers.Authorization, 'Bearer tk_abc');

// Sans sujet : erreur explicite, aucun envoi.
posts.length = 0;
await assert.rejects(context.sendBetaNotification({ ...base, ntfyTopic: '' }, 'm', 't'), /aucun sujet/);
assert.equal(posts.length, 0);

// Masquage des secrets renvoyés à l'interface.
const sanitized = context.sanitizeBetaSettings({
  qbitClients: [], crossSeedInstances: [], announceMappings: [],
  notificationTargets: [{ ...base, ntfyUser: 'u', ntfyPass: 'p', ntfyToken: 'tk_abc' }],
});
const t = sanitized.notificationTargets[0];
assert.equal(t.url, '••••••••');
assert.equal(t.ntfyTopic, '••••••••');
assert.equal(t.ntfyPass, '••••••••');
assert.equal(t.ntfyToken, '••••••••');
assert.equal(t.ntfyUser, 'u');

console.log('check-ntfy OK');

// Régressions du formulaire : exécuter les fonctions de production avec un DOM minimal.
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
function extract(start,end) { return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start))); }
let rows=[];
const ctx={
 betaSettings:{notificationTargets:[],features:{},trackerAlerts:{}},
 document:{querySelectorAll:s=>s==='[data-beta-target]'?rows:[],getElementById:()=>null},
 genId:()=> 'generated', collectBetaTrackerAlertFromDom(){},betaFeatures:()=>({}),renderBetaNotificationTargets(){},
};
vm.createContext(ctx);
vm.runInContext(extract('  function collectBetaSettingsFromDom(', '  function addBetaQbitClient()')+extract('  function changeBetaNotificationType(', '  function removeBetaNotificationTarget('),ctx);
function row(fields) {return {querySelector:s=> {const m=s.match(/data-field="([^"]+)"/);return m&&m[1] in fields?{value:fields[m[1]]}:null;}};}
ctx.betaSettings.notificationTargets=[{id:'first',type:'discord'},{id:'second',type:'discord'}];
rows=[row({type:'ntfy',label:'first',url:'https://example.org',enabled:'true'}),row({type:'discord',label:'second',url:'https://example.net',enabled:'true'})];
vm.runInContext("changeBetaNotificationType(0,'ntfy')",ctx);
assert.equal(ctx.betaSettings.notificationTargets.length,2);
assert.equal(ctx.betaSettings.notificationTargets[0].id,'first');
assert.equal(ctx.betaSettings.notificationTargets[0].type,'ntfy');
assert.equal(ctx.betaSettings.notificationTargets[1].id,'second');
assert.equal(ctx.betaSettings.notificationTargets[1].type,'discord');
ctx.betaSettings.notificationTargets=[{id:'first',type:'ntfy'}];
rows=[row({type:'ntfy',label:'ntfy',url:'https://example.org',enabled:'true',ntfyTopic:'td',ntfyUser:'u',ntfyPass:' pass '})];
const result=vm.runInContext('collectBetaSettingsFromDom()',ctx);
assert.equal(result.notificationTargets[0].ntfyPass,' pass ');
console.log('check-ntfy UI OK: changement de type sans perte de canal et mot de passe intact.');
