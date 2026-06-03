import test from 'node:test';
import assert from 'node:assert/strict';

import IqiyiSource from './sources/iqiyi.js';

test('iQiyi search params use current web profile with a session-like dynamic u', () => {
  const source = new IqiyiSource();

  const params = source._buildSearchParams('都市古仙医');
  const nextParams = source._buildSearchParams('都市古仙医');

  assert.equal(params.key, '都市古仙医');
  assert.equal(params.pcv, '17.052.25283');
  assert.equal(params.version, '17.052.25283');
  assert.equal(params.scale, '300');
  assert.equal(params.os, '10.0');
  assert.equal(params.adExt, JSON.stringify({ r: '2.17.0-ares6-pure' }));
  assert.match(params.u, /^[a-f0-9]{32}$/);
  assert.notEqual(params.u, 'f6440fc5d919dca1aea12b6aff56e1c7');
  assert.equal(nextParams.u, params.u, 'u should stay stable within one source instance');
});
