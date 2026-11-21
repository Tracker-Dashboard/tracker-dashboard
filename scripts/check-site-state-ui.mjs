import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Couleurs d'état du site : vue lignes (fond + filet rouge / orange) et cartes
// (bordure orange pour la maintenance, rouge existante pour les autres erreurs).
const indexHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function sourceBetween(start, end) {
  const from = indexHtml.indexOf(start);
  const to = indexHtml.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `bloc introuvable : ${start}`);
  return indexHtml.slice(from, to);
}
const ui = {};
vm.createContext(ui);
vm.runInContext(sourceBetween('  function siteState(', '  function trackerLogo('), ui);

const offline = { status: 'error', siteReachability: { reachable: false, reason: 'network' } };
const maintenance503 = { status: 'error', siteReachability: { reachable: false, reason: 'http_5xx', statusCode: 503, maintenance: true } };
const maintenance200 = { status: 'error', siteReachability: { reachable: true, statusCode: 200, maintenance: true } };
assert.equal(ui.siteState(offline), 'offline');
assert.equal(ui.siteState(maintenance503), 'maintenance', 'La maintenance prime sur le 503');
assert.equal(ui.siteState(maintenance200), 'maintenance');
assert.equal(ui.siteState({ status: 'error', siteReachability: { reachable: true, statusCode: 200 } }), '',
  'Erreur sur un site joignable : pas de couleur d\'état');
assert.equal(ui.siteState({ status: 'error' }), '');
assert.equal(ui.siteState({ status: 'ok', siteReachability: { reachable: false, reason: 'network' } }), '',
  'Lecture réussie : jamais de couleur d\'état');

// Classes appliquées aux lignes et aux cartes.
assert.match(indexHtml, /<tr class="row-main \$\{isOpen \? 'is-open' : ''\}\$\{siteState\(stat\) \? ` row--\$\{siteState\(stat\)\}` : ''\}">/);
assert.match(indexHtml, /<div class="card \$\{siteState\(stat\) === 'maintenance' \? 'card--maintenance' : 'card--err'\}"/);

// Règles CSS : fond et filet pour les deux états en vue lignes, bordure orange des cartes.
for (const [state, color] of [['offline', 'red'], ['maintenance', 'orange']]) {
  assert.match(indexHtml, new RegExp(`tr\\.row-main\\.row--${state} \\{ background: color-mix\\(in srgb, var\\(--${color}\\) 12%`));
  assert.match(indexHtml, new RegExp(`tr\\.row-main\\.row--${state}:hover \\{ background: color-mix\\(in srgb, var\\(--${color}\\) 18%`));
  assert.match(indexHtml, new RegExp(`tr\\.row-main\\.row--${state} > td:first-child \\{ box-shadow: inset 3px 0 0 var\\(--${color}\\)`));
}
assert.match(indexHtml, /\.card\.card--maintenance \{ border-left-color: var\(--orange\); \}/);
assert.equal((indexHtml.match(/--orange:\s+#[0-9a-f]{6};/g) || []).length, 2, '--orange défini dans les deux thèmes');

console.log('Site state UI checks OK: offline and maintenance rows, maintenance card border.');
