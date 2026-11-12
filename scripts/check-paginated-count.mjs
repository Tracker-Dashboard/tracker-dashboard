import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchExtraField } from '../dist/fetcher.js';

// extraFetch.pagination + count : total = (N - 1) x lignes par page + lignes de la page N.
// Pages synthétiques au format mvc-grid d'ABN (/User/Seeds), vérifié sur un vrai compte
// le 12/11/2026 : 6 pages de 50, 40 lignes sur la dernière -> 290, comme qBittorrent.
const tracker = JSON.parse(fs.readFileSync(new URL('../config/trackers/abnormal.json', import.meta.url), 'utf8'));
const creds = { username: 'fixture-user', password: 'x' };

const rows = n => Array.from({ length: n }, (_, i) => `
            <tr>
                <td>Release.${i}.1080p.WEB-GRP</td>
                <td>16:00:00</td>
                <td>33</td>
                <td>0 o</td>
                <td>0 o</td>
            </tr>`).join('');

function page({ count, active, last, perPage = 50, raquo = '&#187;' }) {
  const buttons = [];
  if (active > 1) buttons.push(`<button type="button" data-page="1">&#171;</button>`);
  else buttons.push(`<button type="button" class="disabled" tabindex="-1">&#171;</button>`);
  for (let p = 1; p <= last; p += 1) {
    buttons.push(`<button type="button"${p === active ? ' class="active"' : ''} data-page="${p}">${p}</button>`);
  }
  buttons.push(active < last
    ? `<button type="button" data-page="${last}">${raquo}</button>`
    : `<button type="button" class="disabled" tabindex="-1">${raquo}</button>`);
  const pager = last > 1 || active > 1
    ? `<div class="mvc-grid-pager" data-show-page-sizes="False">${buttons.join('\n')}
        <input class="mvc-grid-pager-rows" type="hidden" value="${perPage}" /></div>`
    : '';
  return `<html><head><title>Torrents en seed - ABN</title></head><body>
    <a id="manage" class="nav-link" title="Manage" href="/User"><span class="userclass_VIP text-bold">fixture-user</span></a>
    <h1>Torrents en seed : </h1>
    <div class="mvc-grid"><table class="table-rows"><thead><tr class="mvc-grid-headers">
      <th data-name="release-name"><span class="mvc-grid-title">Release</span></th>
    </tr></thead><tbody>${rows(count)}
</tbody></table>${pager}</div></body></html>`;
}

async function run(pages) {
  const seen = [];
  const result = await fetchExtraField(tracker, '', async url => {
    seen.push(url);
    const n = Number(new URL(url).searchParams.get('page') ?? 1);
    const body = pages[n];
    return body === undefined ? null : { status: 200, body };
  }, {}, creds);
  return { value: result?.value, seen };
}

// 6 pages, la dernière avec 40 lignes : une seule requête en plus, vers la page 6.
let r = await run({ 1: page({ count: 50, active: 1, last: 6 }), 6: page({ count: 40, active: 6, last: 6 }) });
assert.equal(r.value, 290);
assert.deepEqual(r.seen, ['https://abn.lol/User/Seeds', 'https://abn.lol/User/Seeds?page=6']);

// Dernière page pleine.
r = await run({ 1: page({ count: 50, active: 1, last: 3 }), 3: page({ count: 50, active: 3, last: 3 }) });
assert.equal(r.value, 150);

// » rendu par un navigateur (caractère au lieu de l'entité) : même résultat.
r = await run({ 1: page({ count: 50, active: 1, last: 2, raquo: '»' }), 2: page({ count: 1, active: 2, last: 2, raquo: '»' }) });
assert.equal(r.value, 51);

// Une seule page : pas de pager, pas de requête en plus.
r = await run({ 1: page({ count: 12, active: 1, last: 1 }) });
assert.equal(r.value, 12);
assert.equal(r.seen.length, 1);

// Aucun torrent en seed : 0 est une vraie valeur.
r = await run({ 1: page({ count: 0, active: 1, last: 1 }) });
assert.equal(r.value, 0);

// Lignes par page absentes du HTML : on retombe sur le nombre de lignes de la page 1.
r = await run({
  1: page({ count: 25, active: 1, last: 4 }).replace(/<input class="mvc-grid-pager-rows"[^>]*>/, ''),
  4: page({ count: 3, active: 4, last: 4 }),
});
assert.equal(r.value, 78);

// Dernière page illisible (erreur, session perdue, page vide) : pas de total faux.
r = await run({ 1: page({ count: 50, active: 1, last: 6 }) });
assert.equal(r.value, undefined);
r = await run({ 1: page({ count: 50, active: 1, last: 6 }), 6: '<html><title>Connexion - ABN</title><input type="password"></html>' });
assert.equal(r.value, undefined);
r = await run({ 1: page({ count: 50, active: 1, last: 6 }), 6: page({ count: 0, active: 6, last: 6 }) });
assert.equal(r.value, undefined);

// Session perdue dès la première page : rien.
r = await run({ 1: '<html><title>Connexion - ABN</title><input type="password"></html>' });
assert.equal(r.value, undefined);

console.log('Paginated count OK: ABN /User/Seeds (N-1) x per page + last page, single page, empty list, per-page fallback and unreadable last page.');
