// Langue des textes produits par le serveur (journaux, notifications). Reprend tels
// quels le moteur et les dictionnaires de l'interface (public/i18n.js et
// public/i18n/<code>.js) : une seule source de traductions pour les deux côtés.
// Les erreurs renvoyées à l'interface restent en français ; le navigateur les traduit.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

interface Engine {
  language: string;
  locale: string;
  translate: (text: string) => string;
}

function loadEngine(code: string): Engine {
  const context: Record<string, unknown> = {
    navigator: { language: code },
    localStorage: { getItem: () => code, setItem: () => {} },
    document: { documentElement: {}, readyState: 'loading', addEventListener: () => {} },
    alert: () => {},
    confirm: () => true,
    prompt: () => null,
  };
  context.window = context;
  vm.createContext(context);
  const dictionary = path.join(PUBLIC_DIR, 'i18n', `${code}.js`);
  if (/^[a-z]{2}$/.test(code) && fs.existsSync(dictionary)) {
    vm.runInContext(fs.readFileSync(dictionary, 'utf8'), context);
  }
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.js'), 'utf8'), context);
  const call = (name: string, ...args: unknown[]) => (context[name] as (...values: unknown[]) => string)(...args);
  return {
    language: call('tdLanguage'),
    locale: call('tdLocale'),
    translate: text => call('tdT', text),
  };
}

let engine: Engine | null = null;
const current = (): Engine => (engine ??= loadEngine('fr'));

/** Change la langue du serveur ; renvoie false si la langue n'est pas prise en charge. */
export function setServerLanguage(code: string): boolean {
  const next = loadEngine(code);
  if (next.language !== code) return false;
  engine = next;
  return true;
}

export const serverLanguage = (): string => current().language;
export const serverLocale = (): string => current().locale;

/** Traduit un texte français (exact ou motif avec valeurs variables) dans la langue du serveur. */
export function t(text: string): string {
  return current().translate(text);
}
