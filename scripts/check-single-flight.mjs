import assert from 'node:assert/strict';

import { SingleFlight } from '../dist/singleFlight.js';

const singleFlight = new SingleFlight();
let calls = 0;
let release;
const gate = new Promise(resolve => { release = resolve; });
const task = async () => {
  calls += 1;
  await gate;
  return 'ok';
};

const first = singleFlight.run('tr4ker', task);
const second = singleFlight.run('tr4ker', task);
assert.strictEqual(first, second);
assert.equal(calls, 0);
await Promise.resolve();
assert.equal(calls, 1);
release();
assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok']);

await Promise.resolve();
assert.equal(await singleFlight.run('tr4ker', async () => {
  calls += 1;
  return 'next';
}), 'next');
assert.equal(calls, 2);

await assert.rejects(singleFlight.run('failure', async () => {
  throw new Error('expected');
}), /expected/);
await Promise.resolve();
assert.equal(await singleFlight.run('failure', async () => 'recovered'), 'recovered');

console.log('Single-flight checks OK: concurrent tracker refreshes share one task and clean up afterwards.');
