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
 * Corrige les installations qui ont reçu V3X pendant la courte période ou sa
 * définition intégrée était livrée avec enabled=true.
 *
 * Le menu « Ajouter un tracker > Tracker intégré » se base sur l'état SQLite,
 * pas directement sur le JSON embarque. Une ancienne ligne v3x enabled=true
 * restait donc active même après le passage du fichier v3x.json à enabled=false.
 *
 * Cette migration est volontairement ciblée et exécutée une seule fois :
 * - pas de ligne V3X en base -> rien à corriger ;
 * - V3X déjà désactivé -> rien à corriger ;
 * - V3X avec credentials/cookie/TOTP -> on respecte l'activation utilisateur ;
 * - V3X actif sans aucune configuration -> on le remet dans le catalogue.
 */
export function migrateV3xCatalogAvailability(): void {
  const state = getJsonSetting(V3X_CATALOG_MIGRATION_KEY, { done: false });
  if (state.done) return;

  // Important : reproduit l'ordre de boot réel. Si une ancienne config JSON du
  // volume doit encore être importée dans SQLite, elle l'est AVANT la correction.
  importLegacyTrackersIfNeeded();

  const bundled = loadDefaultTrackerDefinition('v3x');
  if (!bundled || bundled.enabled !== false) {
    // Ne pas marquer la migration terminée si l'image courante ne contient pas
    // encore la définition V3X attendue.
    return;
  }

  const existing = loadRawTrackerConfigsFromDb().find(config => config.id === 'v3x');
  if (!existing) {
    // Sans ligne SQLite, /api/tracker-definitions considère déjà V3X non actif
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
    console.log('[Migration] V3X remis dans Ajouter un tracker > Tracker intégré');
  }

  setJsonSetting(V3X_CATALOG_MIGRATION_KEY, { done: true });
}

// Anciens domaines de trackers intégrés dont le site a déménagé. Le baseUrl d'une
// instance n'est pas resynchronise depuis l'image (il peut être personnalisé),
// mais un ancien domaine connu doit l'être : Yggrasil est devenu Draupnirr et
// yggrasil.xyz ne fait plus que rediriger, ce qui séparait les cookies de la page
// de login (ancien domaine) du POST de login (nouveau domaine) -> HTTP 419.
const LEGACY_BASE_HOSTS: Record<string, readonly string[]> = {
  yggrasil: ['yggrasil.xyz', 'www.yggrasil.xyz'],
};

/**
 * Remplace le baseUrl d'une instance s'il pointe encore vers un ancien domaine
 * connu de sa définition intégrée. Renvoie true si la config a été modifiée.
 * Un domaine personnalisé (miroir, proxy local) n'est jamais touché.
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
