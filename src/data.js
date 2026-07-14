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

const WINDOW = 100;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) return null;
  if (!(response.headers.get('content-type') || '').includes('json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
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

/**
 * Open the graph data source for a repository.
 * @returns {Promise<{
 *   owner, repo, heads,
 *   view(): { commits, filtered },  // newest-first, reachability-filtered
 *   hasMore(): boolean,
 *   loadOlder(): Promise<void>
 * }>}
 */
export async function openRepoGraph(owner, repo) {
  const base = `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const meta = await fetchJson(`${base}/network/meta`);
  if (!meta || typeof meta.nethash !== 'string') {
    throw new Error('No network-graph data for this repository (empty repo, or GitHub changed the endpoint).');
  }

  const total = Array.isArray(meta.dates) ? meta.dates.length : 0;
  const heads = focusedHeads(meta, owner, repo);
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

  return {
    owner,
    repo,
    heads,

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
