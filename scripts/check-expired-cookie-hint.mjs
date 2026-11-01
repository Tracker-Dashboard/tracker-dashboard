import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-dashboard-expired-cookie-'));
let sqlite;

try {
  process.chdir(temp);
  const db = await import(`${pathToFileURL(path.join(root, 'dist', 'db.js')).href}?expired-cookie=${Date.now()}`);
  const cookies = await import(`${pathToFileURL(path.join(root, 'dist', 'cookies.js')).href}?expired-cookie=${Date.now()}`);
  sqlite = db.getDb();

  const now = Date.UTC(2026, 10, 1, 8, 0, 0);
  const past = Math.floor(Date.UTC(2026, 9, 1, 12, 0, 0) / 1000);
  const future = Math.floor(Date.UTC(2027, 8, 17, 12, 0, 0) / 1000);

  // Netscape : cookie de session perime + cookie d'interface encore valide.
  db.setTrackerCookie('memphis', [
    '# Netscape HTTP Cookie File',
    `#HttpOnly_.memphis.example\tTRUE\t/\tTRUE\t${past}\tmemphis_session\tabc`,
    `memphis.example\tFALSE\t/\tTRUE\t${future}\t__Host-memphis-ui\tdark`,
  ].join('\n'));
  // En-tete Cookie : aucune date connue -> aucune indication.
  db.setTrackerCookie('header-only', 'sid=web-session; uid=1');
  db.setTrackerCookie('fresh', JSON.stringify([{ name: 'sid', value: 'x', expirationDate: future }]));

  const hint = cookies.expiredCookieHint('memphis', now);
  assert.match(hint, /Cookie expire depuis le 01\/10\/2026 \(memphis_session\)/);
  assert.doesNotMatch(hint, /memphis-ui/);
  assert.equal(cookies.expiredCookieHint('header-only', now), '');
  assert.equal(cookies.expiredCookieHint('fresh', now), '');
  assert.equal(cookies.expiredCookieHint('absent', now), '');
  console.log('Expired cookie hint OK: dated expired cookies are named, undated or valid cookies stay silent.');
} finally {
  sqlite?.close();
  process.chdir(root);
  fs.rmSync(temp, { recursive: true, force: true });
}
