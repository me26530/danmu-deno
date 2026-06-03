import test from 'node:test';
import assert from 'node:assert/strict';

import { mapWithConcurrency, normalizeConcurrency, resolveSourceConcurrency } from './utils/concurrency-util.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('mapWithConcurrency should cap active tasks and preserve input order', async () => {
  const gates = Array.from({ length: 5 }, deferred);
  const started = [];
  const activeCounts = [];
  let active = 0;

  const promise = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (item, index) => {
    started.push(index);
    active += 1;
    activeCounts.push(active);
    await gates[index].promise;
    active -= 1;
    return `result-${item}`;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1], 'only the first two tasks should start immediately');
  assert.equal(Math.max(...activeCounts), 2);

  gates[1].resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2], 'third task should start after one slot is released');

  gates[0].resolve();
  gates[2].resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3, 4]);

  gates[4].resolve();
  gates[3].resolve();

  const results = await promise;
  assert.deepEqual(results, ['result-0', 'result-1', 'result-2', 'result-3', 'result-4']);
  assert.ok(activeCounts.every(count => count <= 2));
});

test('mapWithConcurrency should collect failures without cancelling other tasks when requested', async () => {
  const results = await mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
    if (item === 1 || item === 3) {
      throw new Error(`boom-${item}`);
    }
    return item * 10;
  }, { settle: true });

  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled', 'rejected']);
  assert.equal(results[0].value, 0);
  assert.equal(results[2].value, 20);
  assert.equal(results[1].reason.message, 'boom-1');
  assert.equal(results[3].reason.message, 'boom-3');
});

test('mapWithConcurrency should reject on first failure by default', async () => {
  await assert.rejects(
    () => mapWithConcurrency([0, 1, 2], 2, async (item) => {
      if (item === 1) throw new Error('default-failure');
      return item;
    }),
    /default-failure/
  );
});

test('normalizeConcurrency should clamp invalid and excessive values', () => {
  assert.equal(normalizeConcurrency(undefined, 4, 16), 4);
  assert.equal(normalizeConcurrency('0', 4, 16), 4);
  assert.equal(normalizeConcurrency('3', 4, 16), 3);
  assert.equal(normalizeConcurrency('99', 4, 16), 16);
});

test('resolveSourceConcurrency should prefer per-source config over global default', () => {
  assert.equal(resolveSourceConcurrency('tencent', {}), 4);
  assert.equal(resolveSourceConcurrency('tencent', { sourceDetailConcurrency: 6 }), 6);
  assert.equal(resolveSourceConcurrency('tencent', {
    sourceDetailConcurrency: 6,
    sourceDetailConcurrencyBySource: { tencent: 2 },
  }), 2);
  assert.equal(resolveSourceConcurrency('unknown', {
    sourceDetailConcurrency: 0,
    sourceDetailConcurrencyBySource: { unknown: 99 },
  }), 16);
});
