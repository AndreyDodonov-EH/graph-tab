// No-auth data source: GitHub's internal network-graph endpoints.
//
//   GET /{owner}/{repo}/network/meta
//   GET /{owner}/{repo}/network/chunk?nethash={meta.nethash}&start={n}&end={m}
//
// Same-origin fetches from a content script ride the user's session cookie,
// so anything the user can view in the browser (public, private, org repos)
// works with zero setup. The endpoints are undocumented, so parsing is
// defensive and every failure surfaces as a thrown Error the UI can show.
//
// Empirical facts these functions rely on (verified 2026-07, see
// le-git-graph/NETWORK_GRAPH_RENDERER.md):
//   - the chunk array is oldest-first; meta.dates.length is the total count,
//     so the newest window is [total - N, total);
//   - meta/chunk cover the whole fork network with interleaved commits, and
//     the only correct way to isolate the focused repo is reachability from
//     meta.users[0].heads (author/owner/block filtering is wrong);
//   - parents come as [sha, time, space] tuples.

import { lsRefs, fetchMissingCommits } from './gitproto.js';
import { webFreshen } from './webfresh.js';

const WINDOW = 100;

// Opt-in freshness for private repos (see webfresh.js for why it costs one
// page per missing commit). Persisted like column widths (columns.js).
const PRIVATE_FRESH_KEY = 'ggt-private-fresh';

export function privateFreshEnabled() {
  try {
    return localStorage.getItem(PRIVATE_FRESH_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPrivateFreshEnabled(on) {
  try {
    if (on) localStorage.setItem(PRIVATE_FRESH_KEY, '1');
    else localStorage.removeItem(PRIVATE_FRESH_KEY);
  } catch {
    // storage unavailable; the choice just won't stick
  }
}

// The page itself says which it is; content scripts can read it directly.
function isPrivateRepo() {
  return (
    typeof document !== 'undefined' &&
    document.querySelector('meta[name="octolytics-dimension-repository_public"]')?.content === 'false'
  );
}

// The endpoints answer flaky sometimes (rate limits, stray HTML error pages);
// a couple of retries with backoff make loads reliable. 404 stays immediate:
// that is a real "no such repo/graph", not a hiccup.
const RETRY_DELAYS_MS = [500, 1500];

async function fetchJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.status === 404) return null;
      if (response.ok && (response.headers.get('content-type') || '').includes('json')) {
        return await response.json();
      }
    } catch {
      // network error or truncated JSON; retry below
    }
    if (attempt >= RETRY_DELAYS_MS.length) return null;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

// "2025-10-31 21:09:46" (chunk format), ISO strings, or epoch numbers.
function parseDate(value) {
  if (typeof value === 'number') {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  const date = new Date(String(value || '').replace(' ', 'T'));
  return isNaN(date.getTime()) ? new Date() : date;
}

// idx is the commit's absolute position in GitHub's oldest-first network
// array; sorting by it descending reproduces GitHub's own newest-first,
// parents-after-children order that the layout requires.
function mapCommit(raw, idx) {
  if (!raw || typeof raw.id !== 'string') return null;
  const parents = [];
  for (const parent of raw.parents || []) {
    const sha = Array.isArray(parent) ? parent[0] : parent;
    if (typeof sha === 'string') parents.push(sha);
  }
  const message = String(raw.message || '');
  return {
    oid: raw.id,
    parents,
    subject: message.split('\n', 1)[0],
    message,
    author: raw.author || raw.login || '',
    login: raw.login || '',
    avatar:
      typeof raw.gravatar === 'string' && raw.gravatar.startsWith('http')
        ? raw.gravatar
        : raw.login
          ? `https://github.com/${encodeURIComponent(raw.login)}.png?size=40`
          : '',
    date: parseDate(raw.date),
    idx,
  };
}

// meta.users lists every fork in the network as { name, repo, heads }; the
// entry matching the URL (falling back to users[0], the focus) is this repo.
function focusedHeads(meta, owner, repo) {
  if (!Array.isArray(meta.users)) return [];
  const user =
    meta.users.find((u) => u && u.name === owner && u.repo === repo) || meta.users[0];
  if (!user || !Array.isArray(user.heads)) return [];
  const heads = [];
  for (const head of user.heads) {
    const oid = head && (head.id || head.sha || head.oid);
    if (head && head.name && typeof oid === 'string') heads.push({ name: head.name, oid });
  }
  return heads;
}

// Keep only commits reachable from the given heads by walking parent links
// within the loaded set. This is what excludes fork-network commits.
function reachableFrom(byOid, headOids) {
  const reachable = new Set();
  const stack = headOids.filter((oid) => byOid.has(oid));
  while (stack.length > 0) {
    const oid = stack.pop();
    if (reachable.has(oid)) continue;
    reachable.add(oid);
    const commit = byOid.get(oid);
    if (!commit) continue;
    for (const parent of commit.parents) {
      if (byOid.has(parent) && !reachable.has(parent)) stack.push(parent);
    }
  }
  return reachable;
}

// Parents-first order, so spliced commits get ascending idx (children newer).
function topoOrder(commits) {
  const byOid = new Map(commits.map((c) => [c.oid, c]));
  const ordered = [];
  const seen = new Set();
  const visit = (commit) => {
    if (seen.has(commit.oid)) return;
    seen.add(commit.oid);
    for (const parent of commit.parents) {
      const pc = byOid.get(parent);
      if (pc) visit(pc);
    }
    ordered.push(commit);
  };
  commits.forEach(visit);
  return ordered;
}

// The network-graph snapshot lags pushes (server-side cache, minutes to
// hours). git smart-HTTP on the same origin is exact and anonymous for
// public repos: take the real branch heads from ls-refs and splice in the
// commits the snapshot is missing. Any failure (private repo, offline,
// GHES without filter support) leaves the snapshot data untouched and is
// reported as fresh: false so the UI can flag possible staleness.
async function freshen(owner, repo, heads, byOid, nextIdx, onProgress) {
  // Never hit git endpoints on a private repo: the anonymous 401 would make
  // the browser pop its Basic-auth dialog. With the opt-in on, ride the
  // session cookie over the web endpoints instead; identities come straight
  // from the page payload, so no name→login recovery is needed.
  if (isPrivateRepo()) {
    if (!privateFreshEnabled()) return { heads, fresh: false };
    try {
      const result = await webFreshen(owner, repo, heads, byOid, onProgress);
      for (const commit of topoOrder(result.commits)) {
        if (!byOid.has(commit.oid)) byOid.set(commit.oid, { ...commit, idx: nextIdx++ });
      }
      return { heads: result.heads, fresh: result.fresh };
    } catch {
      return { heads, fresh: false };
    }
  }
  try {
    const fresh = await lsRefs(owner, repo);
    if (fresh.length === 0) return { heads, fresh: false };
    const wants = [...new Set(fresh.map((h) => h.oid))].filter((oid) => !byOid.has(oid));
    if (wants.length > 0) {
      const haves = heads.map((h) => h.oid);
      const missing = await fetchMissingCommits(owner, repo, wants, haves, WINDOW);
      // git objects carry name+email, not GitHub identities; recover login and
      // avatar from snapshot commits by the same author, else avatar by email.
      const identities = new Map();
      for (const commit of byOid.values()) {
        if (commit.login && commit.author) {
          identities.set(commit.author, { login: commit.login, avatar: commit.avatar });
        }
      }
      for (const commit of topoOrder(missing)) {
        if (byOid.has(commit.oid)) continue;
        const known = identities.get(commit.author);
        byOid.set(commit.oid, {
          ...commit,
          subject: commit.message.split('\n', 1)[0],
          login: known ? known.login : '',
          avatar: known
            ? known.avatar
            : `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(commit.email)}&s=40`,
          idx: nextIdx++,
        });
      }
    }
    return { heads: fresh, fresh: true };
  } catch {
    return { heads, fresh: false };
  }
}

/**
 * Open the graph data source for a repository.
 * @param onProgress called with a running fetch count while missing commits
 *   are pulled one request at a time (the private-repo opt-in path).
 * @returns {Promise<{
 *   owner, repo, heads,
 *   fresh,    // false when no top-up was available (opted-out private repo, offline)
 *   private,  // true when freshness needs the opt-in (git endpoints reject the session)
 *   view(): { commits, filtered },  // newest-first, reachability-filtered
 *   hasMore(): boolean,
 *   loadOlder(): Promise<void>
 * }>}
 */
export async function openRepoGraph(owner, repo, onProgress = () => {}) {
  const base = `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const meta = await fetchJson(`${base}/network/meta`);
  if (!meta || typeof meta.nethash !== 'string') {
    throw new Error('No network-graph data for this repository (empty repo, or GitHub changed the endpoint).');
  }

  const total = Array.isArray(meta.dates) ? meta.dates.length : 0;
  let heads = focusedHeads(meta, owner, repo);
  const byOid = new Map();

  async function fetchWindow(start, end) {
    const params = new URLSearchParams({ nethash: meta.nethash, start: String(start), end: String(end) });
    const chunk = await fetchJson(`${base}/network/chunk?${params}`);
    if (!chunk || !Array.isArray(chunk.commits)) return false;
    chunk.commits.forEach((raw, i) => {
      const commit = mapCommit(raw, start + i);
      if (commit && !byOid.has(commit.oid)) byOid.set(commit.oid, commit);
    });
    return true;
  }

  const end = total > 0 ? total : WINDOW;
  let loadedStart = Math.max(0, end - WINDOW);
  const ok = await fetchWindow(loadedStart, end);
  if (!ok || byOid.size === 0) {
    throw new Error('Could not load commits from the network graph.');
  }
  const freshened = await freshen(owner, repo, heads, byOid, total, onProgress);
  heads = freshened.heads;

  return {
    owner,
    repo,
    heads,
    fresh: freshened.fresh,
    private: isPrivateRepo(),

    // filtered === false means no focused head landed in the loaded window,
    // so the raw fork network is shown rather than nothing.
    view() {
      const reachable = reachableFrom(byOid, heads.map((h) => h.oid));
      const all = [...byOid.values()];
      const filtered = reachable.size > 0;
      const commits = filtered ? all.filter((c) => reachable.has(c.oid)) : all;
      commits.sort((a, b) => b.idx - a.idx);
      return { commits, filtered };
    },

    hasMore: () => loadedStart > 0,

    async loadOlder() {
      if (loadedStart <= 0) return;
      const olderEnd = loadedStart;
      const olderStart = Math.max(0, olderEnd - WINDOW);
      loadedStart = olderStart; // advance even on failure so a bad window can't loop
      await fetchWindow(olderStart, olderEnd);
    },
  };
}
