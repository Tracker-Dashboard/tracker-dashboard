import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getProxyConfig } from './proxy.js';
import { selectUserAgent } from './userAgent.js';

// Cible minimale pour la récupération d'un logo : on n'a besoin que de l'id et de l'URL.
// (Compatible avec TrackerConfig comme avec les resumes de définitions.)
interface LogoTarget {
  id: string;
  name: string;
  baseUrl: string;
}

// Trois sources, par priorité :
//  1. LOGO_DIR    : logos manuels déposés par l'utilisateur (config/logos) — prioritaires
//  2. AUTO_DIR    : favicons recuperes automatiquement (config/logos/auto)
//  3. SHIPPED_DIR : logos livres avec le code (public/logos) — pour les sites dont le
//                   favicon n'est pas récupérable (Cloudflare/SPA sans <link icon>)
const LOGO_DIR = path.join(process.cwd(), 'config', 'logos');
const AUTO_DIR = path.join(LOGO_DIR, 'auto');
const SHIPPED_DIR = path.join(process.cwd(), 'public', 'logos');

const EXTS = ['svg', 'png', 'ico', 'jpg', 'jpeg', 'gif', 'webp'] as const;

const EXT_BY_TYPE: Record<string, string> = {
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function findExisting(dir: string, id: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const ext of EXTS) {
    const p = path.join(dir, `${id}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Manuel (config/logos) > auto (favicon) > livre avec le code (public/logos). */
export function resolveLogoPath(id: string): string | null {
  return findExisting(LOGO_DIR, id) ?? findExisting(AUTO_DIR, id) ?? findExisting(SHIPPED_DIR, id);
}

function looksLikeImage(type: string | undefined, buf: Buffer): boolean {
  if (type && /^image\//i.test(type)) return true;
  if (buf.length >= 4) {
    const b = buf;
    if (b[0] === 0x89 && b[1] === 0x50) return true;                 // PNG
    if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02)) return true; // ICO/CUR
    if (b[0] === 0xff && b[1] === 0xd8) return true;                 // JPEG
    if (b[0] === 0x47 && b[1] === 0x49) return true;                 // GIF
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46) return true; // RIFF/WEBP
  }
  const head = buf.subarray(0, 256).toString('utf8').toLowerCase();
  return head.includes('<svg');
}

function extFor(type: string, url: string): string {
  if (EXT_BY_TYPE[type]) return EXT_BY_TYPE[type];
  const m = url.match(/\.(svg|png|ico|jpe?g|gif|webp)(?:\?|#|$)/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  return 'ico';
}

async function tryDownload(url: string, trackerId: string): Promise<{ buf: Buffer; type: string; url: string } | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15_000,
      maxRedirects: 5,
      ...getProxyConfig(trackerId),
      headers: { 'User-Agent': selectUserAgent(), 'Accept': 'image/*,*/*;q=0.8' },
      validateStatus: () => true,
    });
    if (res.status >= 400) return null;
    const buf = Buffer.from(res.data as ArrayBuffer);
    if (buf.length === 0 || buf.length > 1_000_000) return null; // garde-fou taille
    const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!looksLikeImage(type, buf)) return null;
    return { buf, type, url };
  } catch {
    return null;
  }
}

function writeAuto(trackerId: string, buf: Buffer, ext: string): void {
  fs.mkdirSync(AUTO_DIR, { recursive: true });
  // Nettoyer les anciennes versions auto avant d'écrire
  for (const e of EXTS) {
    const p = path.join(AUTO_DIR, `${trackerId}.${e}`);
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
  }
  fs.writeFileSync(path.join(AUTO_DIR, `${trackerId}.${ext}`), buf);
}

/**
 * Récupère le favicon d'un tracker via le proxy configuré et le met en cache.
 * Ne touche jamais à un logo manuel (config/logos/<id>.*).
 * Avec force=false (défaut), on saute si un logo (manuel ou auto) existe déjà.
 * Renvoie true si un logo est disponible après l'appel.
 */
export async function fetchTrackerLogo(tracker: LogoTarget, force = false): Promise<boolean> {
  if (findExisting(LOGO_DIR, tracker.id)) return true;                  // logo manuel : on ne touche pas
  if (!force && findExisting(AUTO_DIR, tracker.id)) return true;        // déjà en cache : on saute

  const base = tracker.baseUrl.replace(/\/+$/, '');

  // 1) Tentatives directes sur les chemins favicon courants (souvent servis sans auth).
  // Certains trackers n'exposent pas /favicon.ico mais gardent l'icône dans le thème.
  let result: { buf: Buffer; type: string; url: string } | null = null;
  for (const candidate of [
    `${base}/favicon.ico`,
    `${base}/favicon.png`,
    `${base}/apple-touch-icon.png`,
    `${base}/themes/New_Theme/images/favicon.ico`,
  ]) {
    result = await tryDownload(candidate, tracker.id);
    if (result) break;
  }

  // 2) Sinon, parser la home pour <link rel="icon"> / apple-touch-icon
  if (!result) {
    try {
      const res = await axios.get<string>(`${base}/`, {
        responseType: 'text',
        timeout: 15_000,
        maxRedirects: 5,
        ...getProxyConfig(tracker.id),
        headers: { 'User-Agent': selectUserAgent() },
        validateStatus: () => true,
      });
      if (res.status < 400 && typeof res.data === 'string') {
        const $ = cheerio.load(res.data);
        const hrefs: string[] = [];
        $('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').each((_, el) => {
          const h = $(el).attr('href');
          if (h) hrefs.push(h);
        });
        for (const h of hrefs) {
          try {
            const abs = new URL(h, `${base}/`).toString();
            result = await tryDownload(abs, tracker.id);
            if (result) break;
          } catch { /* href invalide, on continue */ }
        }
      }
    } catch { /* home injoignable : pas de logo auto */ }
  }

  // Échec du fetch : pas "manquant" si un logo livre (public/logos) couvre le tracker.
  if (!result) return resolveLogoPath(tracker.id) !== null;
  writeAuto(tracker.id, result.buf, extFor(result.type, result.url));
  return true;
}

export async function refreshAllLogos(
  trackers: LogoTarget[],
  force = false,
): Promise<Array<{ id: string; name: string; ok: boolean }>> {
  const out: Array<{ id: string; name: string; ok: boolean }> = [];
  // Toutes les définitions du dossier trackers, qu'elles soient actives ou non.
  for (const tracker of trackers) {
    const ok = await fetchTrackerLogo(tracker, force).catch(() => false);
    out.push({ id: tracker.id, name: tracker.name, ok });
  }
  return out;
}

/** Liste des trackers sans aucun logo (ni manuel ni auto) — à fournir à la main. */
export function listTrackersWithoutLogo(trackers: LogoTarget[]): Array<{ id: string; name: string }> {
  return trackers
    .filter(t => !resolveLogoPath(t.id))
    .map(t => ({ id: t.id, name: t.name }));
}

export function hasLogo(id: string): boolean {
  return resolveLogoPath(id) !== null;
}
