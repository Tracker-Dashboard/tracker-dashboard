import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exécuter le rendu de production sans lancer le serveur ni ouvrir de base.
const server = fs.readFileSync(new URL('../dist/server.js', import.meta.url), 'utf8');
const fetcher = fs.readFileSync(new URL('../dist/fetcher.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const context = { betaQbitStats: [] };
vm.createContext(context);
const slice = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};
vm.runInContext([
  slice(fetcher, 'function normalizeNumberString(', 'function parseBytes('),
  slice(server, 'function escapeLabel(', 'function defaultBetaSettings('),
  'function hasStatValue(v) { return v !== null && v !== undefined && v !== ""; }',
  slice(html, 'function parseLocalizedPoints(', 'function formatPoints('),
].join('\n'), context);

for (const [input, expected] of [
  ['12,345', 12345], ['12.345', 12345], ['12,345,678', 12345678],
  ['12.345.678', 12345678], ['12 345', 12345], ['12\u202f345', 12345],
  ['12&nbsp;345', 12345], ['12&#160;345', 12345], ['12&#xa0;345', 12345],
  ['12,345.67', 12345.67], ['12.345,67', 12345.67], ['12 345,67', 12345.67],
  ['12,5', 12.5], ['12.50', 12.5], [12.345, 12.345], ['0', 0], [0, 0],
  ['-1,234', -1234], ['+1,234', 1234],
  ['', null], [' ', null], ['&nbsp;', null], [null, null], [undefined, null],
  ['unavailable', null], ['12 points', null], ['∞', null], [Infinity, null], [NaN, null],
]) {
  const output = context.renderPrometheusMetrics([{
    id: 'fixture', name: 'Fixture', status: 'ok', lastUpdated: '2026-11-23T00:00:00Z',
    fields: { seedBonus: input, points: input, ratio: '1.234', seedTimeDays: '12.345' },
  }]);
  for (const metric of ['tracker_seed_bonus', 'tracker_points']) {
    const line = output.split('\n').find(line => line.startsWith(`${metric}{`));
    if (expected === null) assert.equal(line, undefined, `${metric}: ${String(input)}`);
    else assert.equal(line, `${metric}{tracker="fixture",name="Fixture"} ${expected}`);
  }
  assert.match(output, /tracker_ratio\{[^\n]+\} 1\.234\n/);
  assert.match(output, /tracker_seed_time_days\{[^\n]+\} 12\.345\n/);
  assert.equal(context.pointsToNumber(input), context.parseLocalizedPoints(input)?.number ?? null,
    `Concordance dashboard / Prometheus : ${String(input)}`);
}
console.log('Prometheus points OK: rendu des milliers, décimales, valeurs absentes et parité dashboard ; ratios inchangés.');
