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
  sqlite = db.getDb();

  db.setTrackerCookie('mam', 'mam_id=api-session; uid=12345; mbsc=browser-session');
  db.setTrackerCookie('mam-2', 'mam_id=second-api-session; uid=67890; mbsc=second-browser-session');
  db.setTrackerCookie('other', 'sid=web-session; extra=kept');
  db.setTrackerCookie('other-2', 'sid=second-web-session; extra=kept');

  assert.equal(cookies.buildCookieHeader({ id: 'mam' }), 'mam_id=api-session');
  assert.equal(cookies.buildCookieHeader({ id: 'mam-2', baseId: 'mam' }), 'mam_id=second-api-session');
  assert.equal(cookies.buildCookieHeader({ id: 'other' }), 'sid=web-session; extra=kept');
  assert.equal(cookies.buildCookieHeader({ id: 'other-2', baseId: 'other' }), 'sid=second-web-session; extra=kept');
  assert.equal(cookies.buildCookieHeader({ id: 'mam-3', baseId: 'mam' }), '');
  console.log('MAM API cookie filtering OK for primary and duplicate accounts; other tracker cookies remain unchanged.');
} finally {
  sqlite?.close();
  process.chdir(root);
  fs.rmSync(temp, { recursive: true, force: true });
}
