import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-dashboard-legacy-domain-'));
let server;

try {
  process.chdir(temp);
  const fetcher = await import(`${pathToFileURL(path.join(root, 'dist', 'fetcher.js')).href}?legacy=${Date.now()}`);
  const migrations = await import(`${pathToFileURL(path.join(root, 'dist', 'catalogMigrations.js')).href}?legacy=${Date.now()}`);

  // 1. Un Set-Cookie recu apres une redirection inter-domaines doit etre range sous
  //    le domaine final : 127.0.0.1 (ancien domaine) redirige vers localhost.
  server = http.createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    if (req.method === 'GET' && host === '127.0.0.1') {
      res.writeHead(301, { Location: `http://localhost:${server.address().port}/login` });
      return res.end();
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Set-Cookie': 'laravel-session=fixture; Path=/; HttpOnly' });
      return res.end('<input type="hidden" name="_token" value="t">');
    }
    const ok = (req.headers.cookie ?? '').includes('laravel-session=fixture');
    res.writeHead(ok ? 302 : 419);
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const jar = new CookieJar();
  const client = axios.create({ validateStatus: () => true, maxRedirects: 10, proxy: false });
  fetcher.attachCookieJar(client, jar);
  const pre = await client.get(`http://127.0.0.1:${port}/login`, { responseType: 'text' });
  assert.equal(pre.status, 200);
  const post = await client.post(`http://localhost:${port}/login`, '_token=t', { maxRedirects: 0 });
  assert.equal(post.status, 302, 'the login POST on the new domain must carry the session cookie set after the redirect');

  // 2. L'ancien domaine Yggrasil est migre vers le domaine de la definition integree.
  const definition = { baseUrl: 'https://draupnirr.xyz' };
  const legacy = { id: 'yggrasil', baseUrl: 'https://yggrasil.xyz' };
  assert.equal(migrations.migrateLegacyBaseUrl(legacy, definition), true);
  assert.equal(legacy.baseUrl, 'https://draupnirr.xyz');
  assert.equal(migrations.migrateLegacyBaseUrl(legacy, definition), false, 'migration is idempotent');
  const duplicate = { id: 'yggrasil-2', baseId: 'yggrasil', baseUrl: 'https://www.yggrasil.xyz/' };
  assert.equal(migrations.migrateLegacyBaseUrl(duplicate, definition), true);
  assert.equal(duplicate.baseUrl, 'https://draupnirr.xyz');
  const mirror = { id: 'yggrasil', baseUrl: 'https://mirror.example' };
  assert.equal(migrations.migrateLegacyBaseUrl(mirror, definition), false, 'a custom domain is never rewritten');
  assert.equal(migrations.migrateLegacyBaseUrl({ id: 'other', baseUrl: 'https://yggrasil.xyz' }, definition), false);
  console.log('Legacy domain OK: cookies follow redirects, yggrasil.xyz instances move to draupnirr.xyz.');
} finally {
  server?.close();
  process.chdir(root);
  fs.rmSync(temp, { recursive: true, force: true });
}
