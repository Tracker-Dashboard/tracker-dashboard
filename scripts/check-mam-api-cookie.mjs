import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-dashboard-mam-cookie-'));
let sqlite;

try {
  process.chdir(temp);
  const db = await import(`${pathToFileURL(path.join(root, 'dist', 'db.js')).href}?mam-cookie=${Date.now()}`);
  const cookies = await import(`${pathToFileURL(path.join(root, 'dist', 'cookies.js')).href}?mam-cookie=${Date.now()}`);

  db.setTrackerCookie('mam', 'mam_id=api-session; uid=12345; mbsc=browser-session');
  db.setTrackerCookie('other', 'sid=web-session; extra=kept');

  assert.equal(cookies.buildCookieHeader('mam'), 'mam_id=api-session');
  assert.equal(cookies.buildCookieHeader('other'), 'sid=web-session; extra=kept');
  sqlite = db.getDb();
  console.log('MAM API cookie filtering OK; other tracker cookies remain unchanged.');
} finally {
  sqlite?.close();
  process.chdir(root);
  fs.rmSync(temp, { recursive: true, force: true });
}
