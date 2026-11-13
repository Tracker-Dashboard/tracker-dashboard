import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getJsonSetting, setJsonSetting } from './db.js';
import { ensureSshSocks, getSshLocalEndpoint, type SshProxyConfig } from './sshTunnel.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProxySettings {
  enabled: boolean;
  /** 'http' | 'https' | 'socks4' | 'socks5' | 'ssh' | 'direct' */
  type: string;
  host: string;
  port: string;
  username: string;
  password: string;
  /** SSH uniquement : cle privee PEM (alternative au mot de passe) */
  privateKey?: string;
  /** SSH uniquement : passphrase de la cle privee (optionnel) */
  passphrase?: string;
}

/**
 * Surcharge de proxy par tracker — pour tel ou tel site on passe par un autre
 * proxy que le proxy global. Pratique pour des sites qui blacklistent l'IP
 * du proxy principal.
 */
export interface ProxyOverride {
  id: string;
  label: string;
  enabled: boolean;
  /** Si true, ce tracker sort sans proxy meme si un proxy global est actif. */
  direct: boolean;
  /** Liste des ids de trackers qui passent par ce proxy */
  trackers: string[];
  type: string;
  host: string;
  port: string;
  username: string;
  password: string;
  /** SSH uniquement : cle privee PEM (alternative au mot de passe) */
  privateKey?: string;
  /** SSH uniquement : passphrase de la cle privee (optionnel) */
  passphrase?: string;
}

export interface ProxyAxiosConfig {
  httpAgent?: unknown;
  httpsAgent?: unknown;
}

// ─── Lecture / ecriture settings ──────────────────────────────────────────────

export function loadProxySettings(): ProxySettings {
  return getJsonSetting('proxy', defaultProxy());
}

export function saveProxySettings(proxy: ProxySettings): void {
  setJsonSetting('proxy', proxy);
}

export function loadProxyOverrides(): ProxyOverride[] {
  const raw = getJsonSetting('proxy_overrides', [] as ProxyOverride[]);
  return Array.isArray(raw) ? raw : [];
}

export function saveProxyOverrides(overrides: ProxyOverride[]): void {
  setJsonSetting('proxy_overrides', overrides);
}

function defaultProxy(): ProxySettings {
  return {
    enabled: false,
    type: 'socks5',
    host: '',
    port: '',
    username: '',
    password: '',
  };
}

// ─── Resolution proxy pour un tracker donne ───────────────────────────────────

/**
 * Renvoie le proxy effectif pour un tracker :
 *  - s'il existe un override active qui liste ce trackerId, on l'utilise
 *  - sinon, on retombe sur le proxy global
 *
 * Le retour est un ProxySettings (meme forme) pour que les callers s'en
 * fichent : ils ne savent pas si c'est l'override ou le global.
 */
export function resolveProxyForTracker(trackerId?: string): ProxySettings {
  if (trackerId) {
    const override = loadProxyOverrides().find(
      o => o.enabled && Array.isArray(o.trackers) && o.trackers.includes(trackerId),
    );
    if (override?.direct) {
      return {
        enabled: false,
        type: 'direct',
        host: '',
        port: '',
        username: '',
        password: '',
      };
    }
    if (override && override.host && override.port) {
      return {
        enabled: true,
        type:     override.type,
        host:     override.host,
        port:     override.port,
        username: override.username,
        password: override.password,
        privateKey: override.privateKey,
        passphrase: override.passphrase,
      };
    }
  }
  return loadProxySettings();
}

// ─── Config axios ─────────────────────────────────────────────────────────────

/** Extrait une SshProxyConfig depuis un ProxySettings de type 'ssh' (ou null). */
export function toSshConfig(proxy: ProxySettings): SshProxyConfig | null {
  if (proxy.type !== 'ssh' || !proxy.host || !proxy.port) return null;
  const port = Number.parseInt(proxy.port, 10);
  if (!Number.isFinite(port) || port <= 0) return null;
  return {
    host: proxy.host,
    port,
    username: proxy.username,
    password: proxy.password || undefined,
    privateKey: proxy.privateKey || undefined,
    passphrase: proxy.passphrase || undefined,
  };
}

/**
 * Prepare le proxy d'un tracker avant fetch : pour un proxy SSH, etablit (ou
 * reutilise) le tunnel SSH + SOCKS5 local. A appeler AVANT getProxyConfig, qui
 * est synchrone et lit l'endpoint local en cache.
 */
export async function ensureProxyReady(trackerId?: string): Promise<void> {
  const proxy = resolveProxyForTracker(trackerId);
  const ssh = toSshConfig(proxy);
  if (!ssh) return;
  try {
    await ensureSshSocks(ssh);
  } catch (err) {
    console.error('[Proxy SSH] Tunnel indisponible :', err instanceof Error ? err.message : err);
  }
}

export function buildProxyConfig(proxy: ProxySettings): ProxyAxiosConfig {
  if (!proxy.enabled || !proxy.host || !proxy.port) return {};

  // Proxy SSH : on relaie via le SOCKS5 local adosse au tunnel SSH (deja etabli
  // par ensureProxyReady). S'il n'est pas pret, pas de proxy (echec propre cote fetch).
  if (proxy.type === 'ssh') {
    const ssh = toSshConfig(proxy);
    const endpoint = ssh ? getSshLocalEndpoint(ssh) : null;
    if (!endpoint) return {};
    try {
      const agent = new SocksProxyAgent(`socks5://${endpoint.host}:${endpoint.port}`);
      return { httpAgent: agent, httpsAgent: agent };
    } catch (err: unknown) {
      console.error('[Proxy SSH] Erreur agent local :', err instanceof Error ? err.message : err);
      return {};
    }
  }

  const auth     = proxy.username && proxy.password
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : '';
  const proxyUrl = `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;

  try {
    const agent = proxy.type.startsWith('socks')
      ? new SocksProxyAgent(proxyUrl)
      : new HttpsProxyAgent(proxyUrl);
    return { httpAgent: agent, httpsAgent: agent };
  } catch (err: unknown) {
    console.error('[Proxy] Erreur de configuration :', err instanceof Error ? err.message : err);
    return {};
  }
}

export function getProxyConfig(trackerId?: string): ProxyAxiosConfig {
  return buildProxyConfig(resolveProxyForTracker(trackerId));
}

export function logProxyStatus(): void {
  const p = loadProxySettings();
  if (p.enabled && p.host && p.port) {
    console.log(`Proxy global : ${p.type}://${p.host}:${p.port}`);
  } else {
    console.log('Proxy global desactive, connexion directe');
  }
  const overrides = loadProxyOverrides().filter(o => o.enabled);
  if (overrides.length > 0) {
    for (const o of overrides) {
      const target = o.trackers.join(', ') || '(aucun tracker)';
      const route = o.direct ? 'connexion directe' : `${o.type}://${o.host}:${o.port}`;
      console.log(`  Override [${o.label || o.id}] -> ${route} pour ${target}`);
    }
  }
}
