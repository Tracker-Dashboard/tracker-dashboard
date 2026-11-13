import {
  getJsonSetting,
  hasTrackerCookie,
  hasTrackerTotpSecret,
  importLegacyTrackersIfNeeded,
  listTrackerCredentialSummaries,
  loadDefaultTrackerDefinition,
  loadRawTrackerConfigsFromDb,
  saveTrackerConfig,
  setJsonSetting,
} from './db.js';

const V3X_CATALOG_MIGRATION_KEY = 'migration_v3x_catalog_availability_v1';

/**
 * Corrige les installations qui ont recu V3X pendant la courte periode ou sa
 * definition integree etait livree avec enabled=true.
 *
 * Le menu « Ajouter un tracker > Tracker integre » se base sur l'etat SQLite,
 * pas directement sur le JSON embarque. Une ancienne ligne v3x enabled=true
 * restait donc active meme apres le passage du fichier v3x.json a enabled=false.
 *
 * Cette migration est volontairement ciblee et executee une seule fois :
 * - pas de ligne V3X en base -> rien a corriger ;
 * - V3X deja desactive -> rien a corriger ;
 * - V3X avec credentials/cookie/TOTP -> on respecte l'activation utilisateur ;
 * - V3X actif sans aucune configuration -> on le remet dans le catalogue.
 */
export function migrateV3xCatalogAvailability(): void {
  const state = getJsonSetting(V3X_CATALOG_MIGRATION_KEY, { done: false });
  if (state.done) return;

  // Important : reproduit l'ordre de boot reel. Si une ancienne config JSON du
  // volume doit encore etre importee dans SQLite, elle l'est AVANT la correction.
  importLegacyTrackersIfNeeded();

  const bundled = loadDefaultTrackerDefinition('v3x');
  if (!bundled || bundled.enabled !== false) {
    // Ne pas marquer la migration terminee si l'image courante ne contient pas
    // encore la definition V3X attendue.
    return;
  }

  const existing = loadRawTrackerConfigsFromDb().find(config => config.id === 'v3x');
  if (!existing) {
    // Sans ligne SQLite, /api/tracker-definitions considere deja V3X non actif
    // et l'affiche dans « Ajouter un tracker ».
    setJsonSetting(V3X_CATALOG_MIGRATION_KEY, { done: true });
    return;
  }

  const credential = listTrackerCredentialSummaries().find(item => item.trackerId === 'v3x');
  const configured = Boolean(
    credential?.hasPassword
    || hasTrackerCookie('v3x')
    || hasTrackerTotpSecret('v3x')
  );

  if (existing.enabled !== false && !configured) {
    saveTrackerConfig({ ...existing, enabled: false });
    console.log('[Migration] V3X remis dans Ajouter un tracker > Tracker integre');
  }

  setJsonSetting(V3X_CATALOG_MIGRATION_KEY, { done: true });
}

// Anciens domaines de trackers integres dont le site a demenage. Le baseUrl d'une
// instance n'est pas resynchronise depuis l'image (il peut etre personnalise),
// mais un ancien domaine connu doit l'etre : Yggrasil est devenu Draupnirr et
// yggrasil.xyz ne fait plus que rediriger, ce qui separait les cookies de la page
// de login (ancien domaine) du POST de login (nouveau domaine) -> HTTP 419.
const LEGACY_BASE_HOSTS: Record<string, readonly string[]> = {
  yggrasil: ['yggrasil.xyz', 'www.yggrasil.xyz'],
};

/**
 * Remplace le baseUrl d'une instance s'il pointe encore vers un ancien domaine
 * connu de sa definition integree. Renvoie true si la config a ete modifiee.
 * Un domaine personnalise (miroir, proxy local) n'est jamais touche.
 */
export function migrateLegacyBaseUrl(
  tracker: { id: string; name?: string; baseId?: string; baseUrl: string },
  definition: { baseUrl: string } | null,
): boolean {
  if (!definition?.baseUrl) return false;
  const legacyHosts = LEGACY_BASE_HOSTS[tracker.baseId ?? tracker.id];
  if (!legacyHosts) return false;
  let host: string;
  try {
    host = new URL(tracker.baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!legacyHosts.includes(host)) return false;
  const target = definition.baseUrl.replace(/\/+$/, '');
  if (tracker.baseUrl === target) return false;
  tracker.baseUrl = target;
  console.log(`[Migration] ${tracker.name ?? tracker.id} : ancien domaine ${host} remplace par ${target}`);
  return true;
}
