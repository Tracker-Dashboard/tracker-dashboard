import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Charge le dictionnaire puis le moteur dans un environnement minimal, en anglais.
const loadEngine = language => {
  const context = {
    navigator: { language },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: {}, readyState: 'loading', addEventListener: () => {} },
    alert: () => {},
    confirm: () => true,
    prompt: () => null,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('public/i18n/en.js'), context);
  vm.runInContext(read('public/i18n.js'), context);
  return context;
};

const dictionary = loadEngine('en').TD_I18N.en;
const errors = [];

for (const [fr, en] of Object.entries(dictionary.exact)) {
  if (!fr.trim() || !String(en).trim()) errors.push(`Traduction vide : ${JSON.stringify(fr)}`);
  if (fr.includes('{}')) errors.push(`Valeur variable hors des motifs : ${JSON.stringify(fr)}`);
}
for (const [fr, en] of dictionary.patterns) {
  const slots = fr.split('{}').length - 1;
  const used = [...en.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
  if (slots === 0) errors.push(`Motif sans valeur variable : ${JSON.stringify(fr)}`);
  if (used.some(index => index < 1 || index > slots)) errors.push(`Motif mal numéroté : ${JSON.stringify(fr)}`);
}

// Tout texte fixe des pages qui ressemble à du français doit avoir sa traduction.
const french = /[éèàçêùâôîûœÉÀ]|\b(le|la|les|des|du|une|et|pour|avec|sans|aucun|aucune|est|sont|dans|sur|par|vos|votre|ton|tes|cette)\b/i;
const decode = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const normalize = text => decode(text).replace(/\s+/g, ' ').trim();
const engine = loadEngine('en');
for (const file of ['public/index.html', 'public/login.html']) {
  const markup = read(file).replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
  const texts = [
    ...[...markup.matchAll(/>([^<>]+)</g)].map(match => match[1]),
    ...[...markup.matchAll(/\s(?:title|placeholder|aria-label|alt)="([^"]+)"/g)].map(match => match[1]),
  ].map(normalize).filter(text => text && french.test(text));
  for (const text of new Set(texts)) {
    if (engine.tdT(text) === text) errors.push(`${file} : texte sans traduction anglaise ${JSON.stringify(text)}`);
  }
}

// Tout texte français du code (scripts des pages, serveur) doit avoir sa traduction :
// erreurs affichées, notifications, journaux. Une valeur interpolée vaut « 7 ».
const frenchWords = /[éèàçêùâôîûœÉÀ]|\b(le|la|les|des|du|une|et|pour|avec|sans|aucun|aucune|est|sont|dans|sur|par|vos|votre|cette|pas|ou|au|aux|de|en|un|il|ne|que|qui|ce|ces|si|non|lu|lus|mais|alerte|jour|jours|erreur|introuvable|invalide|requis|requise|manquant|manquants|attente|depuis|apres|avant|encore|deja|toujours|serveur|fichier|connexion|compte|actif|actifs|desactive|lance|ecoute|repli|demarrage|rafraichissement|sauvegarde|sauvegardee|mot|passe|heure|heures|semaine|mois|seuil|identifiant|identifiants|utilisateur|reponse|echec|echecs|succes|reussi|termine|terminee|ignore|trouve|recu|recue|recus|envoye|envoyes|disponible|indisponible|bloque|bloquee|planifie|cible|vide|absent|absente|dernier|derniere|prochain|prochaine|echouee|evite|expiree|leve|consecutifs|conservees|depasse|interrompu|appele|sauves|invalidees|impactes|reinitialise|authentification|annonce|hote|recupere|demande|partiel|liaison|furtif|perso|copie)\b/i;
const notText = /^[\w.$-]+$|^[a-z]+:\/\/|[{};]\s*$|=>|<\/?[a-z]/i;
// Textes à ne pas traduire : reconnaissance des pages des trackers, aide Prometheus.
const untranslated = new Set([
  'Vérification que vous n&#39;êtes pas un robot',
  'Verification que vous n&#39;etes pas un robot',
  "Pièces d'or",
  'Seeds en cours',
  'Votre solde',
  'Active seeding torrents',
  'Active leeching torrents',
  '1 if last API read succeeded, 0 if failed, absent if no API key',
  '1 if last ping succeeded, 0 if failed, absent if not measured',
]);
const sources = [];
for (const file of ['public/index.html', 'public/login.html']) {
  for (const match of read(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) sources.push([file, match[1], ts.ScriptKind.JS]);
}
const tsFiles = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? tsFiles(path.join(dir, entry.name)) : entry.name.endsWith('.ts') ? [path.join(dir, entry.name)] : []);
for (const file of tsFiles('src')) sources.push([file, read(file), ts.ScriptKind.TS]);
for (const [file, code, kind] of sources) {
  const visit = node => {
    let text = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join('7');
    if (text !== null) {
      text = text.replace(/\s+/g, ' ').trim();
      if (text.length > 3 && frenchWords.test(text) && !notText.test(text) && /[a-zà-ÿ]{3}/i.test(text)
        && !untranslated.has(text) && engine.tdT(text) === text) {
        errors.push(`${file} : texte sans traduction anglaise ${JSON.stringify(text)}`);
      }
    }
    if (!ts.isTemplateExpression(node)) ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind));
}

// Comportement : texte exact, espaces de bord, valeurs variables, texte inconnu.
assert.equal(engine.tdT('Vue lignes'), 'List view');
assert.equal(engine.tdT('  Vue   lignes \n'), '  List view \n');
assert.equal(engine.tdT('il y a 5min'), '5min ago');
assert.equal(engine.tdT('Prochaine exécution : non planifiée'), 'Next run: not scheduled');
assert.equal(engine.tdT('Options avancées'), 'Advanced options');
assert.equal(engine.tdT('Supprimer définitivement le tracker « Demo » et toutes ses données (identifiants, historique) ?'),
  'Permanently delete the tracker “Demo” and all its data (credentials, history)?');
assert.equal(engine.tdT('Generation-Free'), 'Generation-Free');
assert.equal(engine.tdLocale(), 'en-GB');

// Textes assemblés par le serveur : erreurs avec détails, valeurs insérées, journaux.
assert.equal(engine.tdT('Login échoué — HTTP 403 - dump: /data/x.html'), 'Login failed — HTTP 403 - dump: /data/x.html');
assert.equal(engine.tdT('LOGIN EN ECHEC (stats lues via l\'API) : Login échoué — HTTP 403'),
  'LOGIN FAILED (stats read via the API): Login failed — HTTP 403');
assert.equal(engine.tdT('  [Demo] Unité d\'affichage alignée sur le site : GB (décimal)'), '  [Demo] Display unit aligned with the site: GB (decimal)');
assert.equal(engine.tdT('✅ 3 ok ❌ 1 erreur(s) ⚙️ 2 non configure(s)'), '✅ 3 ok ❌ 1 error(s) ⚙️ 2 not configured');
assert.equal(engine.tdT('2 échecs'), '2 failures');
// L'unité du buffer est déjà traduite par formatBytesForNotif, le seuil par le motif.
assert.equal(engine.tdT('Demo : buffer 1.50 GiB < 5 Go'), 'Demo: buffer 1.50 GiB < 5 GB');
assert.equal(engine.tdT('Gio'), 'GiB');

// Le serveur emploie le même moteur et les mêmes dictionnaires (journaux, notifications).
const server = await import('../dist/i18n.js');
assert.equal(server.t('Timeout lors du refresh'), 'Timeout lors du refresh', 'Le serveur démarre en français');
assert.equal(server.setServerLanguage('en'), true);
assert.equal(server.t('Timeout lors du refresh'), 'Timeout during refresh');
assert.equal(server.serverLocale(), 'en-GB');
assert.equal(server.setServerLanguage('xx'), false, 'Une langue inconnue est refusée');
assert.equal(server.serverLanguage(), 'en');
// Morceaux assemblés par buildNotifications.
const notificationPieces = new Map([
  ['3 succès', '3 succeeded'],
  ['1 échec', '1 failure'],
  ['2 MPs', '2 PMs'],
  ['1 MP non lu', '1 unread PM'],
  ['4 MP non lus', '4 unread PMs'],
  ['2 alertes', '2 alerts'],
  ['Sites rétablis : Demo, Test', 'Sites back up: Demo, Test'],
  ['Demo : ratio 0.80 < 1', 'Demo: ratio 0.80 < 1'],
  ['Demo : session ancienne (40 j, seuil 30 j)', 'Demo: old session (40 d, threshold 30 d)'],
  ['erreur inconnue', 'unknown error'],
  ['Test Tracker Dashboard Beta : notification recue.', 'Tracker Dashboard Beta test: notification received.'],
]);
for (const [fr, en] of notificationPieces) assert.equal(server.t(fr), en);
server.setServerLanguage('fr');
assert.equal(server.t('Timeout lors du refresh'), 'Timeout lors du refresh');

const frenchEngine = loadEngine('fr');
assert.equal(frenchEngine.tdT('Vue lignes'), 'Vue lignes');
assert.equal(frenchEngine.tdLocale(), 'fr-FR');
assert.equal(loadEngine('de').tdLanguage(), 'fr', 'Une langue non prise en charge retombe sur le français');

if (errors.length > 0) {
  console.error(errors.map(error => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(`i18n OK : ${Object.keys(dictionary.exact).length} textes et ${dictionary.patterns.length} motifs anglais ; pages, scripts et serveur couverts.`);
