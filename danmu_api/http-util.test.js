import test from 'node:test';
import assert from 'node:assert/strict';

import { Globals } from './configs/globals.js';
import { httpGet, httpPost, httpDelete } from './utils/http-util.js';

function resetRuntime() {
  Globals.init({ LOG_LEVEL: 'error', VOD_REQUEST_TIMEOUT: '1000' });
}

function installFetch(status = 404, body = { message: 'not found' }) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

test('httpGet should return caller-accepted non-2xx status without retrying', async () => {
  resetRuntime();
  const fetchMock = installFetch(404, { msg: 'empty danmu' });

  try {
    const response = await httpGet('https://example.test/not-found', {
      validStatusCodes: [404],
      retries: 2,
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.data, { msg: 'empty danmu' });
    assert.equal(fetchMock.calls.length, 1, 'accepted 404 should not trigger retry');
  } finally {
    fetchMock.restore();
  }
});

test('httpGet should still reject non-whitelisted non-2xx status', async () => {
  resetRuntime();
  const fetchMock = installFetch(404, { msg: 'not allowed' });

  try {
    await assert.rejects(
      () => httpGet('https://example.test/not-found', { retries: 0 }),
      /HTTP error! status: 404/
    );
  } finally {
    fetchMock.restore();
  }
});

test('generic HTTP methods should honor validStatusCodes', async () => {
  resetRuntime();
  const fetchMock = installFetch(409, { ok: false, conflict: true });

  try {
    const postResponse = await httpPost('https://example.test/conflict', '{}', {
      validStatusCodes: [409],
      headers: { 'content-type': 'application/json' },
    });
    const deleteResponse = await httpDelete('https://example.test/conflict', {
      validStatusCodes: [409],
    });

    assert.equal(postResponse.status, 409);
    assert.deepEqual(postResponse.data, { ok: false, conflict: true });
    assert.equal(deleteResponse.status, 409);
    assert.deepEqual(deleteResponse.data, { ok: false, conflict: true });
    assert.equal(fetchMock.calls.length, 2);
  } finally {
    fetchMock.restore();
  }
});
