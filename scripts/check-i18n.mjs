import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

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

const frenchEngine = loadEngine('fr');
assert.equal(frenchEngine.tdT('Vue lignes'), 'Vue lignes');
assert.equal(frenchEngine.tdLocale(), 'fr-FR');
assert.equal(loadEngine('de').tdLanguage(), 'fr', 'Une langue non prise en charge retombe sur le français');

if (errors.length > 0) {
  console.error(errors.map(error => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(`i18n OK : ${Object.keys(dictionary.exact).length} textes et ${dictionary.patterns.length} motifs anglais, pages couvertes.`);
