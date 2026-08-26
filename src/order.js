// Row order for the graph: newest-first, children always above their parents.
//
// GitHub's network array is date-ordered, so its absolute position (`idx`)
// reversed is the order layout() wants. Commits spliced in from git or from
// the commit pages have no such position, so they get a *fractional* idx
// derived from their date (chronoIndex) and are then merged into the same
// ordering. Dates alone cannot be trusted to keep a child above its parent
// (clock skew, rebases, a merge older than what it merges), and layout()
// breaks if a parent is emitted first — so the final order is decided
// topologically, using idx only to choose between commits that are ready.
//
// Pure and DOM-free so it can be unit-tested in Node.

// Local time throughout: data.js parses the chunk timestamps without a zone,
// so they are already local, and meta.dates is the day axis they sit on.
// Mixing in UTC here would put a commit in the wrong day bucket.
function isoDay(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

// Fraction of the day a date sits at, so same-day commits keep their order.
function fractionOfDay(date) {
  return (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) / 86400;
}

/**
 * Where `date` belongs in GitHub's oldest-first, day-granular `meta.dates`.
 * Returns a fractional index: `n - 1 + fraction`, where n is the number of
 * days at or before it. A commit newer than the whole array therefore lands
 * above its last entry, and one older than all of it lands below index 0 —
 * both without colliding with a real array position.
 *
 * @param {string[]} dates ascending "YYYY-MM-DD" strings (meta.dates)
 */
export function chronoIndex(dates, date) {
  const valid = date instanceof Date && !isNaN(date.getTime());
  const day = valid ? isoDay(date) : '';
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1 + (valid ? fractionOfDay(date) : 0);
}

// Max-heap on idx; ties broken by oid so the order is deterministic.
function makeHeap() {
  const items = [];
  const above = (a, b) => (a.idx !== b.idx ? a.idx > b.idx : a.oid > b.oid);
  return {
    get size() {
      return items.length;
    },
    push(item) {
      items.push(item);
      for (let i = items.length - 1; i > 0; ) {
        const parent = (i - 1) >> 1;
        if (!above(items[i], items[parent])) break;
        [items[i], items[parent]] = [items[parent], items[i]];
        i = parent;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length > 0) {
        items[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let best = i;
          if (l < items.length && above(items[l], items[best])) best = l;
          if (r < items.length && above(items[r], items[best])) best = r;
          if (best === i) break;
          [items[i], items[best]] = [items[best], items[i]];
          i = best;
        }
      }
      return top;
    },
  };
}

/**
 * Newest-first order for `commits` (each { oid, parents, idx }) in which no
 * commit appears after one of its own parents. Among the commits that are
 * ready (all of their loaded children already emitted) the largest idx wins,
 * so the result stays as close to chronological as the graph allows.
 *
 * @returns {Array} the same commit objects, reordered.
 */
export function orderCommits(commits) {
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const pending = new Map(); // oid -> number of loaded children not yet emitted
  for (const commit of commits) pending.set(commit.oid, 0);
  for (const commit of commits) {
    for (const parent of new Set(commit.parents)) {
      if (pending.has(parent)) pending.set(parent, pending.get(parent) + 1);
    }
  }

  const heap = makeHeap();
  for (const commit of commits) if (pending.get(commit.oid) === 0) heap.push(commit);

  const ordered = [];
  const emitted = new Set();
  while (heap.size > 0) {
    const commit = heap.pop();
    if (emitted.has(commit.oid)) continue;
    emitted.add(commit.oid);
    ordered.push(commit);
    for (const parent of new Set(commit.parents)) {
      if (!pending.has(parent)) continue;
      const left = pending.get(parent) - 1;
      pending.set(parent, left);
      if (left === 0) heap.push(byOid.get(parent));
    }
  }

  // A cycle (impossible in git, but the data is third-party) would strand
  // commits; append them by idx rather than dropping rows on the floor.
  if (ordered.length < commits.length) {
    const rest = commits.filter((commit) => !emitted.has(commit.oid));
    rest.sort((a, b) => b.idx - a.idx);
    ordered.push(...rest);
  }
  return ordered;
}
