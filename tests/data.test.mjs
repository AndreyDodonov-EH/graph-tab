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

test('private repo with the opt-in freshens via web pages, never git', async () => {
  const FRESH_OID = 'b'.repeat(40);
  const realFetch = globalThis.fetch;
  globalThis.document = {
    querySelector: (selector) =>
      selector.includes('repository_public') ? { content: 'false' } : null,
  };
  globalThis.localStorage = {
    getItem: (key) => (key === 'ggt-private-fresh' ? '1' : null),
  };
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('.git/')) throw new Error('git endpoint hit on a private repo');
    if (path.includes('/network/meta')) {
      return jsonResponse({
        nethash: 'h',
        dates: ['2026-01-01'],
        users: [{ name: 'o', repo: 'r', heads: [{ name: 'main', id: OID }] }],
      });
    }
    if (path.includes('/network/chunk')) {
      return jsonResponse({
        commits: [{ id: OID, parents: [], author: 'X', login: 'x', date: '2026-01-01 00:00:00', message: 'old' }],
      });
    }
    if (path.includes('/latest-commit/main')) return jsonResponse({ oid: FRESH_OID });
    if (path.includes(`/commit/${FRESH_OID}`)) {
      return jsonResponse({
        payload: {
          commit: {
            oid: FRESH_OID,
            parents: [OID],
            authoredDate: '2026-01-02T00:00:00Z',
            shortMessageMarkdownLink: '<a href="/x">new</a>',
            authors: [{ login: 'y', displayName: 'Y', avatarUrl: 'https://a/y.png' }],
          },
        },
      });
    }
    throw new Error('unexpected url: ' + path);
  };
  try {
    const source = await openRepoGraph('o', 'r');
    assert.equal(source.private, true);
    assert.equal(source.fresh, true);
    assert.deepEqual(source.heads, [{ name: 'main', oid: FRESH_OID }]);
    const { commits } = source.view();
    assert.deepEqual(commits.map((c) => c.oid), [FRESH_OID, OID]);
    assert.equal(commits[0].login, 'y');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.document;
    delete globalThis.localStorage;
  }
});

test('private repo without the opt-in keeps the snapshot, marked stale', async () => {
  const realFetch = globalThis.fetch;
  globalThis.document = {
    querySelector: (selector) =>
      selector.includes('repository_public') ? { content: 'false' } : null,
  };
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('.git/') || path.includes('/latest-commit/')) {
      throw new Error('freshen fetch without opt-in: ' + path);
    }
    if (path.includes('/network/meta')) {
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
    assert.equal(source.private, true);
    assert.equal(source.fresh, false);
    assert.equal(source.view().commits.length, 1);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.document;
  }
});

test('202 (snapshot being generated) is polled through', async () => {
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0); // collapse the waits
  let metaCalls = 0;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('.git/')) return new Response('', { status: 401 });
    if (path.includes('/network/meta')) {
      if (++metaCalls <= 2) return new Response('', { status: 202 });
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
    assert.equal(source.view().commits.length, 1);
    assert.equal(metaCalls, 3);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
  }
});

test('persistent 202 surfaces a "still generating" error, not "no data"', async () => {
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
  let metaCalls = 0;
  globalThis.fetch = async () => {
    metaCalls++;
    return new Response('', { status: 202 });
  };
  try {
    await assert.rejects(() => openRepoGraph('o', 'r'), /still generating/);
    assert.equal(metaCalls, 6); // initial attempt + the five pending waits
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
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
