import test from 'node:test';
import assert from 'node:assert/strict';
import { openRepoGraph } from '../src/data.js';

const OID = 'a'.repeat(40);

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

test('meta fetch is retried after a transient failure', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    calls.push(path);
    if (path.includes('.git/')) return new Response('', { status: 401 }); // no freshen
    if (path.includes('/network/meta')) {
      // first attempt: flaky HTML error page; second: real payload
      if (calls.filter((c) => c.includes('/network/meta')).length === 1) {
        return new Response('<html>error</html>', { status: 500 });
      }
      return jsonResponse({
        nethash: 'h',
        dates: ['2026-01-01'],
        users: [{ name: 'o', repo: 'r', heads: [{ name: 'main', id: OID }] }],
      });
    }
    if (path.includes('/network/chunk')) {
      return jsonResponse({
        commits: [{ id: OID, parents: [], author: 'X', login: 'x', date: '2026-01-01 00:00:00', message: 'hi' }],
      });
    }
    throw new Error('unexpected url: ' + path);
  };
  try {
    const source = await openRepoGraph('o', 'r');
    const { commits } = source.view();
    assert.equal(commits.length, 1);
    assert.equal(commits[0].oid, OID);
    assert.equal(source.fresh, false);
    assert.equal(calls.filter((c) => c.includes('/network/meta')).length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('404 fails immediately without retries', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response('', { status: 404 });
  };
  try {
    await assert.rejects(() => openRepoGraph('o', 'gone'), /No network-graph data/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
