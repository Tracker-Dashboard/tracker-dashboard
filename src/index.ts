import { start } from './server.js';
import { migrateV3xCatalogAvailability } from './catalogMigrations.js';
import { getJsonSetting } from './db.js';
import { serverLocale, setServerLanguage, t } from './i18n.js';

function translateLogArg(arg: unknown): unknown {
  if (typeof arg === 'string') return t(arg);
  if (arg instanceof Error) {
    const message = t(arg.message);
    if (message === arg.message) return arg;
    const copy = new Error(message);
    copy.name = arg.name;
    copy.stack = arg.stack?.replace(arg.message, message);
    return copy;
  }
  return arg;
}

function timestampLogs(): void {
  const stamp = () => new Date().toLocaleString(serverLocale(), {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    // Les messages sont écrits en français dans le code et traduits ici, dans la
    // langue choisie dans l'interface.
    console[level] = (...args: unknown[]) => original(`[${stamp()}]`, ...args.map(translateLogArg));
  }
}

setServerLanguage(getJsonSetting<string>('ui_language', 'fr'));
timestampLogs();
migrateV3xCatalogAvailability();
start().catch(console.error);
