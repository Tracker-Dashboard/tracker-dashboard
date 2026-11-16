import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import { fetchUnreadMessages } from '../dist/fetcher.js';

const c411 = JSON.parse(fs.readFileSync(new URL('../config/trackers/c411.json', import.meta.url), 'utf8'));

const seen = [];
const count = await fetchUnreadMessages(c411, async (url, headers) => {
  seen.push({ url, headers });
  return { status: 200, body: JSON.stringify({ total: 4 }) };
}, { Authorization: 'Bearer test-token' });

assert.equal(count, 4);
assert.deepEqual(seen, [{
  url: 'https://c411.org/api/messages/unread-count',
  headers: { Authorization: 'Bearer test-token' },
}]);

const htmlTracker = {
  ...c411,
  fetch: {
    ...c411.fetch,
    unreadFetch: {
      url: 'notifications',
      responseType: 'html',
      regex: 'Inbox[^>]*>(?<value>\\d+)',
      transform: 'integer',
    },
  },
};

assert.equal(await fetchUnreadMessages(htmlTracker, async () => ({
  status: 200,
  body: '<div data-type="Inbox">2</div>',
}), {}), 2);

assert.equal(await fetchUnreadMessages(c411, async () => ({
  status: 503,
  body: 'indisponible',
}), {}), '');

assert.equal(await fetchUnreadMessages(c411, async () => {
  throw new Error('network');
}, {}), '');

const indexHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function sourceBetween(start, end) {
  const startIndex = indexHtml.indexOf(start);
  const endIndex = indexHtml.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `Source UI introuvable: ${start}`);
  assert.notEqual(endIndex, -1, `Fin de source UI introuvable: ${end}`);
  return indexHtml.slice(startIndex, endIndex);
}

const uiContext = {};
vm.runInNewContext([
  sourceBetween('  function hasStatValue', '  function formatCount'),
  sourceBetween('  function unreadMessagesCount', '  function mpBadge'),
  sourceBetween('  function mpBadge', '  // Notes d\'incident'),
].join('\n'), uiContext);

assert.equal(uiContext.unreadMessagesCount({ fields: { unreadMessages: 'un' } }), 1);
assert.equal(uiContext.mpBadge({ fields: { unreadMessages: 3 } }).includes('MP : 3'), true);
assert.equal(uiContext.mpBadge({ fields: { unreadMessages: 0 } }), '');
assert.equal(uiContext.mpBadge({ fields: {} }), '');

// Vue lignes : badge MP juste apres le nom, dans les memes cas que les cartes
// (lecture OK, login KO avec stats API, donnees perimees), jamais en erreur.
vm.runInNewContext(sourceBetween('  function rowMpBadge', '  function renderRow'), uiContext);
assert.equal(uiContext.rowMpBadge({ status: 'ok', fields: { unreadMessages: 2 } }).includes('MP : 2'), true);
assert.equal(uiContext.rowMpBadge({ status: 'ok', fields: {} }), '');
assert.equal(uiContext.rowMpBadge({ status: 'ok', loginError: 'refus', fields: { unreadMessages: 'un' } }).includes('MP : 1'), true);
assert.equal(uiContext.rowMpBadge({ status: 'ok', stale: { error: 'timeout' }, fields: { unreadMessages: 4 } }).includes('MP : 4'), true);
assert.equal(uiContext.rowMpBadge({ status: 'error', fields: { unreadMessages: 4 } }), '');
assert.match(indexHtml, /<td class="cell-name">\$\{trackerName\(stat\)\}\$\{rowMpBadge\(stat\)\}/);

// Badge MP clignotant (cartes et lignes), sans animation si l'OS demande moins de mouvement.
assert.match(indexHtml, /\.badge-mp \{[^}]*animation: mp-blink /);
assert.match(indexHtml, /@keyframes mp-blink \{/);
assert.match(indexHtml, /@media \(prefers-reduced-motion: reduce\) \{ \.badge-mp \{ animation: none; \} \}/);

console.log('Unread message checks OK: authenticated requests, best-effort failures, badge visibility in cards and rows, blinking style.');
