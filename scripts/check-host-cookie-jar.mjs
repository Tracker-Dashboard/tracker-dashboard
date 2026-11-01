import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CookieJar } from 'tough-cookie';

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-dashboard-host-cookie-'));
let sqlite;

try {
  process.chdir(temp);
  const db = await import(`${pathToFileURL(path.join(root, 'dist', 'db.js')).href}?host-cookie=${Date.now()}`);
  const fetcher = await import(`${pathToFileURL(path.join(root, 'dist', 'fetcher.js')).href}?host-cookie=${Date.now()}`);
  sqlite = db.getDb();

  // Les prefixes __Host- et __Secure- exigent l'attribut Secure : sans lui, le jar
  // les ignorait et le fallback axios partait sans cookie de session.
  db.setTrackerCookie('https-site', '__Host-site_session=abc; __Secure-token=def; __csrf=ghi');
  const jar = new CookieJar();
  await fetcher.injectStoredCookieIntoJar({ id: 'https-site', baseUrl: 'https://tracker.example/' }, jar);
  const names = (await jar.getCookies('https://tracker.example/')).map(c => c.key).sort();
  assert.deepEqual(names, ['__Host-site_session', '__Secure-token', '__csrf']);

  db.setTrackerCookie('http-site', 'sid=plain');
  const httpJar = new CookieJar();
  await fetcher.injectStoredCookieIntoJar({ id: 'http-site', baseUrl: 'http://tracker.example/' }, httpJar);
  assert.deepEqual((await httpJar.getCookies('http://tracker.example/')).map(c => c.key), ['sid']);
  console.log('Stored __Host-/__Secure- cookies reach the axios jar on HTTPS trackers; HTTP trackers unchanged.');
} finally {
  sqlite?.close();
  process.chdir(root);
  fs.rmSync(temp, { recursive: true, force: true });
}
