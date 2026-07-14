// DOM/SVG renderer. Consumes the pure layout() output: one <svg> for the
// whole graph column, absolutely positioned over fixed-height HTML rows
// (vscode-git-graph's structural model). Curved lane transitions use the
// same cubic-bezier shape as vscode-git-graph. Colors come from a fixed
// palette; text and chrome use GitHub's CSS variables so both themes work.

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

/**
 * Render the graph view into `container` (cleared first).
 * model: { owner, repo, commits, graph, heads, filtered, hasMore, onLoadOlder }
 */
export function render(container, model) {
  const { owner, repo, commits, graph, heads, filtered, hasMore, onLoadOlder } = model;

  const refsByOid = new Map();
  for (const head of heads) {
    if (!refsByOid.has(head.oid)) refsByOid.set(head.oid, []);
    refsByOid.get(head.oid).push(head.name);
  }
  const headOids = new Set(refsByOid.keys());

  const root = el('div', 'ggt-root');

  const header = el('div', 'ggt-header');
  header.appendChild(el('h2', 'ggt-title', 'Graph'));
  const parts = [`${commits.length} commits`, `${heads.length} branches`];
  if (hasMore) parts.push('older history below');
  if (!filtered) parts.push('fork-network view (no branch head in the loaded window)');
  header.appendChild(el('span', 'ggt-meta', parts.join(' · ')));
  root.appendChild(header);

  const wrap = el('div', 'ggt-wrap');
  const { svg, width } = buildSvg(graph, headOids, commits);
  const rows = el('div', 'ggt-rows');

  commits.forEach((commit, i) => {
    const row = el('div', 'ggt-row');
    row.style.paddingLeft = width + 8 + 'px';

    const refs = refsByOid.get(commit.oid);
    if (refs) {
      const refsBox = el('span', 'ggt-refs');
      for (const name of refs) {
        const chip = el('span', 'ggt-ref', name);
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

    const author = el('span', 'ggt-author');
    if (commit.avatar) {
      const img = el('img', 'ggt-avatar');
      img.src = commit.avatar;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => img.remove());
      author.appendChild(img);
    }
    author.appendChild(document.createTextNode(commit.login || commit.author));
    row.appendChild(author);

    const time = el('time', 'ggt-date', relTime(commit.date));
    time.title = commit.date.toLocaleString();
    row.appendChild(time);

    const sha = el('a', 'ggt-sha', commit.oid.slice(0, 7));
    sha.href = `/${owner}/${repo}/commit/${commit.oid}`;
    row.appendChild(sha);

    rows.appendChild(row);
  });

  wrap.appendChild(rows);
  wrap.appendChild(svg);
  root.appendChild(wrap);

  if (hasMore) {
    const more = el('button', 'ggt-more', 'Load older commits');
    more.addEventListener('click', async () => {
      more.disabled = true;
      more.textContent = 'Loading…';
      await onLoadOlder();
    });
    root.appendChild(more);
  }

  container.textContent = '';
  container.appendChild(root);
}

/** Centered status/error message in place of the graph. */
export function renderStatus(container, text, isError = false) {
  container.textContent = '';
  const status = el('div', 'ggt-status' + (isError ? ' ggt-error' : ''), text);
  container.appendChild(status);
}
