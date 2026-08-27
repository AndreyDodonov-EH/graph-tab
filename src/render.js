// DOM/SVG renderer. Consumes the pure layout() output: one <svg> for the
// whole graph column, absolutely positioned over fixed-height HTML rows
// (vscode-git-graph's structural model). Curved lane transitions use the
// same cubic-bezier shape as vscode-git-graph. Colors come from a fixed
// palette; text and chrome use GitHub's CSS variables so both themes work.
//
// Everything sits inside a bordered "shell" styled like GitHub's own boxed
// lists: a muted toolbar (title, counts subtitle, actions), status banners,
// the graph, and a muted footer with the pagination button.

import { initColumns } from './columns.js';

const ROW_H = 28;
const LANE_W = 14;
const PAD_X = 12;
const MAX_LANES = 20; // graph column width cap; wider histories are clipped

const PALETTE = [
  '#0085d9', '#d9008f', '#00d90a', '#d98500', '#a300d9', '#ff0000',
  '#00d9cc', '#e138e8', '#85d900', '#dc5b23', '#6f24d6', '#ffcc00',
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function colorOf(index) {
  return PALETTE[index % PALETTE.length];
}

function px(x) {
  return PAD_X + x * LANE_W;
}

function py(y) {
  return y * ROW_H + ROW_H / 2;
}

function relTime(date) {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  if (seconds < 30 * 86400) return Math.floor(seconds / 86400) + 'd';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

function buildSvg(graph, headOids, commits) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const width = PAD_X + Math.min(graph.laneCount, MAX_LANES) * LANE_W;
  svg.setAttribute('class', 'ggt-svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(graph.nodes.length * ROW_H));

  for (const seg of graph.segments) {
    const x1 = px(seg.x1), y1 = py(seg.y1);
    const x2 = px(seg.x2), y2 = py(seg.y2);
    let d;
    if (seg.x1 === seg.x2) {
      d = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else {
      const c = (y2 - y1) * 0.8;
      d = `M ${x1} ${y1} C ${x1} ${y1 + c}, ${x2} ${y2 - c}, ${x2} ${y2}`;
    }
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', colorOf(seg.color));
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    if (seg.dashed) {
      path.setAttribute('stroke-dasharray', '3,3');
      path.setAttribute('opacity', '0.55');
    }
    svg.appendChild(path);
  }

  graph.nodes.forEach((node, i) => {
    const cx = String(px(node.x));
    const cy = String(py(node.row));
    const color = colorOf(node.color);
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.setAttribute('r', '3.5');
    dot.setAttribute('fill', color);
    svg.appendChild(dot);
    if (headOids.has(commits[i].oid)) {
      const ring = document.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('cx', cx);
      ring.setAttribute('cy', cy);
      ring.setAttribute('r', '6');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', color);
      ring.setAttribute('stroke-width', '1.5');
      svg.appendChild(ring);
    }
  });

  return { svg, width };
}

// The framed box with its toolbar: title plus the muted subtitle under it.
function buildShell(subtitle) {
  const shell = el('section', 'ggt-shell');
  const toolbar = el('div', 'ggt-toolbar');
  const titles = el('div', 'ggt-titles');
  titles.appendChild(el('h2', 'ggt-title', 'Commit graph'));
  if (subtitle) titles.appendChild(el('span', 'ggt-subtitle', subtitle));
  toolbar.appendChild(titles);
  shell.appendChild(toolbar);
  return { shell, toolbar };
}

function avatarFallback(commit) {
  const initial = (commit.login || commit.author || '?').charAt(0).toUpperCase();
  const span = el('span', 'ggt-avatar ggt-avatar-fallback', initial);
  span.setAttribute('aria-hidden', 'true');
  return span;
}

/**
 * Render the graph view into `container` (cleared first).
 * model: { owner, repo, commits, graph, heads, tags, fresh, filtered, total,
 *   loaded, olderCount, failedWindows, hasMore, onLoadOlder, onRefresh,
 *   private, privateFresh, onToggleFresh }
 */
export function render(container, model) {
  const {
    owner, repo, commits, graph, heads, tags, fresh, filtered, hasMore,
    total, loaded, olderCount, failedWindows, onLoadOlder, onRefresh,
    private: priv, privateFresh, onToggleFresh,
  } = model;

  const refsByOid = new Map();
  for (const head of heads) {
    if (!refsByOid.has(head.oid)) refsByOid.set(head.oid, []);
    refsByOid.get(head.oid).push(head.name);
  }
  const headOids = new Set(refsByOid.keys());
  const tagsByOid = new Map();
  for (const tag of tags) {
    if (!tagsByOid.has(tag.oid)) tagsByOid.set(tag.oid, []);
    tagsByOid.get(tag.oid).push(tag.name);
  }

  const root = el('div', 'ggt-root');
  const grandTotal = Math.max(total, loaded);
  const { shell, toolbar } = buildShell(
    `${owner}/${repo} · ${loaded} of ${grandTotal} commits loaded · ` +
      `${heads.length} ${heads.length === 1 ? 'branch' : 'branches'}` +
      (tags.length > 0 ? ` · ${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}` : ''),
  );

  const actions = el('div', 'ggt-actions');
  if (priv) {
    const label = el('label', 'ggt-fresh');
    label.title =
      "Show the latest commits, plus tags, instead of GitHub's cached snapshot. " +
      'On a private repository this takes one small request per new commit and per tag, ' +
      'so the first load can take a while; fetched commits are cached on this device.';
    const box = el('input');
    box.type = 'checkbox';
    box.checked = privateFresh;
    box.addEventListener('change', () => onToggleFresh(box.checked));
    label.append(box, 'fetch fresh commits');
    actions.appendChild(label);
  }
  const pill = el('span', 'ggt-pill' + (fresh ? ' ggt-pill-fresh' : ''), fresh ? 'Fresh' : 'Cached');
  pill.title = fresh
    ? 'Branch heads were verified live; the graph is current.'
    : priv && !privateFresh
      ? "GitHub's cached snapshot — it can lag pushes by minutes to hours. " +
        'Tick "fetch fresh commits" to top it up.'
      : "Freshness could not be verified — GitHub's cached snapshot may lag recent pushes.";
  actions.appendChild(pill);
  const refresh = el('button', 'ggt-btn', 'Refresh');
  refresh.title = 'Reload the graph from GitHub';
  refresh.addEventListener('click', () => {
    refresh.disabled = true;
    onRefresh();
  });
  actions.appendChild(refresh);
  toolbar.appendChild(actions);

  if (!filtered) {
    shell.appendChild(el('div', 'ggt-banner',
      'No branch head of this repository is inside the loaded window — showing the raw fork network.'));
  }
  if (failedWindows > 0) {
    shell.appendChild(el('div', 'ggt-banner ggt-banner-error',
      `Skipped ${failedWindows} older window${failedWindows === 1 ? '' : 's'} ` +
        'that GitHub could not return — the graph may have gaps.'));
  }

  const { svg, width } = buildSvg(graph, headOids, commits);
  const divider = initColumns(root, { graph: width + 20, author: 150, date: 88, sha: 64 });

  const cols = el('div', 'ggt-head');
  cols.appendChild(el('span', 'ggt-h-graph', 'Graph'));
  cols.appendChild(el('span', 'ggt-h-desc', 'Description'));
  cols.appendChild(el('span', 'ggt-author', 'Author'));
  cols.appendChild(el('span', 'ggt-date', 'Date'));
  cols.appendChild(el('span', 'ggt-sha', 'Commit'));
  cols.appendChild(divider('graph', +1));
  cols.appendChild(divider('author', -1));
  cols.appendChild(divider('date', -1));
  cols.appendChild(divider('sha', -1));
  shell.appendChild(cols);

  const rows = el('div', 'ggt-rows');

  commits.forEach((commit, i) => {
    const row = el('div', 'ggt-row');

    const refs = refsByOid.get(commit.oid);
    const tagNames = tagsByOid.get(commit.oid);
    if (refs || tagNames) {
      const refsBox = el('span', 'ggt-refs');
      // /tree/ serves both branches and tags; encode per segment so names
      // with slashes stay path-shaped, as GitHub's own links do.
      const treeHref = (name) =>
        `/${owner}/${repo}/tree/${name.split('/').map(encodeURIComponent).join('/')}`;
      for (const name of refs || []) {
        const chip = el('a', 'ggt-ref', name);
        chip.href = treeHref(name);
        chip.style.color = colorOf(graph.nodes[i].color);
        chip.style.borderColor = 'currentColor';
        refsBox.appendChild(chip);
      }
      for (const name of tagNames || []) {
        const chip = el('a', 'ggt-ref ggt-tag', name);
        chip.href = treeHref(name);
        chip.title = `tag: ${name}`;
        chip.style.color = colorOf(graph.nodes[i].color);
        chip.style.borderColor = 'currentColor';
        refsBox.appendChild(chip);
      }
      row.appendChild(refsBox);
    }

    const msg = el('a', 'ggt-msg', commit.subject || commit.oid.slice(0, 7));
    msg.href = `/${owner}/${repo}/commit/${commit.oid}`;
    if (commit.message !== commit.subject || commit.author) {
      msg.title = commit.message + (commit.author ? `\n\n${commit.author}` : '');
    }
    row.appendChild(msg);

    const author = el(commit.login ? 'a' : 'span', 'ggt-author');
    if (commit.login) author.href = `/${encodeURIComponent(commit.login)}`;
    if (commit.avatar) {
      const img = el('img', 'ggt-avatar');
      img.src = commit.avatar;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => img.replaceWith(avatarFallback(commit)));
      author.appendChild(img);
    } else {
      author.appendChild(avatarFallback(commit));
    }
    author.appendChild(document.createTextNode(commit.login || commit.author));
    row.appendChild(author);

    const time = el('time', 'ggt-date', commit.date ? relTime(commit.date) : '—');
    time.title = commit.date ? commit.date.toLocaleString() : 'Date unavailable';
    row.appendChild(time);

    const sha = el('a', 'ggt-sha', commit.oid.slice(0, 7));
    sha.href = `/${owner}/${repo}/commit/${commit.oid}`;
    row.appendChild(sha);

    rows.appendChild(row);
  });

  const wrap = el('div', 'ggt-wrap');
  wrap.appendChild(rows);
  wrap.appendChild(svg);
  shell.appendChild(wrap);

  if (hasMore) {
    const footer = el('div', 'ggt-footer');
    const more = el('button', 'ggt-btn', `Load ${olderCount} older commit${olderCount === 1 ? '' : 's'}`);
    more.addEventListener('click', async () => {
      more.disabled = true;
      more.textContent = 'Loading…';
      more.setAttribute('aria-busy', 'true');
      await onLoadOlder();
    });
    footer.appendChild(more);
    footer.appendChild(el('span', 'ggt-footer-count', `${loaded} of ${grandTotal} loaded`));
    footer.setAttribute('aria-live', 'polite');
    shell.appendChild(footer);
  }

  root.appendChild(shell);
  container.textContent = '';
  container.appendChild(root);
}

/**
 * Centered status message inside the framed shell, in place of the graph.
 * options: { error, busy, detail, onRetry }. busy adds an indeterminate
 * progress bar (the number of pending fetches is unknown — parents are
 * discovered one commit page at a time); onRetry adds a "Try again" button.
 */
export function renderStatus(container, repoRef, text, options = {}) {
  const { error = false, busy = false, detail = '', onRetry = null } = options;
  container.textContent = '';
  const root = el('div', 'ggt-root');
  const { shell } = buildShell(repoRef ? `${repoRef.owner}/${repoRef.repo}` : '');
  if (busy) shell.setAttribute('aria-busy', 'true');

  const status = el('div', 'ggt-status' + (error ? ' ggt-error' : ''));
  if (error) status.setAttribute('role', 'alert');
  status.appendChild(el('div', null, text));
  if (detail) status.appendChild(el('div', 'ggt-status-detail', detail));
  if (busy) {
    const track = el('div', 'ggt-progress');
    track.appendChild(el('div', 'ggt-progress-fill'));
    status.appendChild(track);
  }
  if (onRetry) {
    const retry = el('button', 'ggt-btn ggt-retry', 'Try again');
    retry.addEventListener('click', onRetry);
    status.appendChild(retry);
  }
  shell.appendChild(status);
  root.appendChild(shell);
  container.appendChild(root);
}
