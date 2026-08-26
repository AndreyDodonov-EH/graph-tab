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
import { octicon } from './octicon.js';

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

// The branch picker: which branches the graph draws.
//
// Copied in behaviour from GitHub's own repository dropdown (Primer's
// FilteredActionList): an anchor button, a filter box, and a list of
// role="option" rows whose selection lives in a leading slot. Two things
// matter beyond the looks:
//
//   - The list is an overlay on document.body, positioned against the
//     button, not a child of the toolbar. Inside the graph shell it would be
//     part of the layout (and clipped by the shell's overflow); on the body
//     it floats over the page like GitHub's own menus do.
//   - A click applies straight away. There is no Apply, no bulk-clear and no
//     close button: the two rows at the top are the bulk actions, and
//     clicking outside or pressing Escape closes the menu.
//
// Applying re-renders the whole view, which rebuilds this control, so the
// open state and the filter text live at module scope and are restored.

const PANEL_WIDTH = 320;
let panelOpen = false;
let panelFilter = '';
let livePanel = null;
// Listeners the open overlay puts on document/window. Applying a pick
// re-renders the view and builds a fresh control, so the previous one has to
// hand these back — a stale outside-click handler whose panel is already
// detached sees every click as "outside" and shuts the new menu.
let detachPanel = null;

/** Drop the overlay — the view is going away and it lives on document.body. */
export function closeBranchPicker() {
  detachPanel?.();
  detachPanel = null;
  livePanel?.remove();
  livePanel = null;
  panelOpen = false;
  panelFilter = '';
}

function buildBranchPicker(model) {
  const { branches, selected, defaultBranch, onSelectBranches, canFetch } = model;
  detachPanel?.();
  detachPanel = null;
  livePanel?.remove();

  const counter = el('span', 'ggt-counter', `${selected.size}/${branches.length}`);
  const button = el('button', 'ggt-btn ggt-select-btn');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.title = 'Choose which branches the graph draws';
  button.append(
    octicon('git-branch'),
    el('span', 'ggt-select-label', 'Branches'),
    counter,
    octicon('triangle-down', 'ggt-select-caret'),
  );

  const panel = el('div', 'ggt-panel');
  panel.hidden = true;
  livePanel = panel;

  const filterBox = el('div', 'ggt-filter');
  filterBox.appendChild(octicon('search', 'ggt-filter-icon'));
  const filter = el('input', 'ggt-filter-input');
  filter.type = 'text';
  filter.placeholder = 'Find a branch...';
  filter.setAttribute('aria-label', 'Filter branches');
  filter.value = panelFilter;
  filterBox.appendChild(filter);
  panel.appendChild(filterBox);

  const list = el('ul', 'ggt-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-multiselectable', 'true');
  list.setAttribute('aria-label', 'Branches');
  panel.appendChild(list);

  let busy = false;
  async function apply(names, row) {
    if (busy) return;
    busy = true;
    panel.setAttribute('aria-busy', 'true');
    row?.classList.add('ggt-item-busy');
    await onSelectBranches(names);
    // The re-render replaces this control; nothing to restore here.
  }

  // One row, shaped like Primer's ActionList item: selection slot, leading
  // visual, label, optional trailing state.
  function addRow({ label, on, icon, tag, tagClass, tagTitle, disabled, onPick }) {
    const item = el('li', 'ggt-item' + (on ? ' ggt-item-on' : ''));
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(on));
    item.tabIndex = -1;
    const check = el('span', 'ggt-check');
    check.appendChild(octicon('check'));
    item.append(check, octicon(icon, 'ggt-item-icon'), el('span', 'ggt-item-name', label));
    if (tag) {
      const pill = el('span', 'ggt-item-tag' + (tagClass ? ' ' + tagClass : ''), tag);
      if (tagTitle) pill.title = tagTitle;
      item.appendChild(pill);
    }
    if (disabled) item.setAttribute('aria-disabled', 'true');
    else {
      item.addEventListener('click', () => onPick(item));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick(item);
        }
      });
    }
    list.appendChild(item);
    return item;
  }

  // Bulk actions first, as two ordinary rows — that is what replaces the old
  // footer buttons.
  const names = branches.map((branch) => branch.name);
  const pickable = branches.filter((branch) => branch.loaded || canFetch).map((b) => b.name);
  addRow({
    label: 'All branches',
    on: selected.size === branches.length,
    icon: 'git-branch',
    onPick: (row) => apply(pickable, row),
  });
  if (defaultBranch && names.includes(defaultBranch)) {
    addRow({
      label: `Only ${defaultBranch}`,
      on: selected.size === 1 && selected.has(defaultBranch),
      icon: 'git-branch',
      onPick: (row) => apply([defaultBranch], row),
    });
  }
  list.appendChild(el('li', 'ggt-divider'));

  const rows = [];
  const ordered = [...branches].sort((a, b) => {
    const rank = (branch) =>
      (branch.name === defaultBranch ? 0 : 2) - (selected.has(branch.name) ? 1 : 0);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  for (const branch of ordered) {
    // Nothing can pull an unloaded branch in without a live ref source: a
    // private repository rejects anonymous git and needs the freshness opt-in.
    const locked = !branch.loaded && !canFetch;
    const on = selected.has(branch.name);
    const only = on && selected.size === 1;
    const item = addRow({
      label: branch.name,
      on,
      icon: 'git-branch',
      tag: branch.name === defaultBranch ? 'default' : branch.loaded ? '' : canFetch ? 'fetch' : 'unavailable',
      tagClass: branch.name === defaultBranch ? '' : 'ggt-item-fetch',
      tagTitle: branch.loaded
        ? ''
        : canFetch
          ? 'Outside the loaded window — picking this pulls the branch in.'
          : 'Outside the loaded window. Tick "fetch fresh commits" to make it available.',
      disabled: locked,
      onPick: (row) => {
        // A graph of no branches is not a state worth reaching by accident.
        if (only) return;
        const next = on
          ? [...selected].filter((name) => name !== branch.name)
          : [...selected, branch.name];
        apply(next, row);
      },
    });
    if (only) item.title = 'At least one branch has to be shown.';
    rows.push({ name: branch.name, item });
  }

  const empty = el('li', 'ggt-list-empty', 'No branches match.');
  empty.hidden = true;
  list.appendChild(empty);

  function runFilter() {
    panelFilter = filter.value;
    const needle = panelFilter.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const hit = !needle || row.name.toLowerCase().includes(needle);
      row.item.hidden = !hit;
      if (hit) shown++;
    }
    empty.hidden = shown > 0;
  }
  filter.addEventListener('input', runFilter);

  // Anchored to the button, clamped to the viewport, kept in place while the
  // page scrolls under it. The positioning itself is set inline rather than
  // left to the stylesheet: the manifest-injected CSS only refreshes when the
  // extension is reloaded, while the modules are re-read on every page load,
  // so after an update the JS can run against last version's CSS. A fixed
  // element with no rules at all would then sit at its static position — the
  // end of <body>, bottom-left of the page — which is exactly what happened.
  function place() {
    const box = button.getBoundingClientRect();
    const left = Math.max(8, Math.min(box.right - PANEL_WIDTH, innerWidth - PANEL_WIDTH - 8));
    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: '1000',
      width: `${PANEL_WIDTH}px`,
      left: `${left}px`,
      top: `${box.bottom + 4}px`,
      maxHeight: `${Math.max(180, innerHeight - box.bottom - 24)}px`,
    });
  }

  const onDocClick = (event) => {
    if (!panel.contains(event.target) && !button.contains(event.target)) close();
  };
  // Escape has to be watched on the document, not on the panel: picking a
  // row applies straight away and focus is usually back on the page by then.
  const onKey = (event) => {
    if (event.key === 'Escape') {
      close();
      button.focus();
    }
  };
  const detach = () => {
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', place, true);
    removeEventListener('resize', place);
  };
  function close() {
    panel.hidden = true;
    panelOpen = false;
    button.setAttribute('aria-expanded', 'false');
    detach();
    detachPanel = null;
  }
  function open(focusFilter) {
    panel.hidden = false;
    panelOpen = true;
    button.setAttribute('aria-expanded', 'true');
    place();
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
    detachPanel = detach;
    if (focusFilter) filter.focus();
  }
  button.addEventListener('click', () => (panel.hidden ? open(true) : close()));

  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const visible = [...list.querySelectorAll('.ggt-item')].filter((item) => !item.hidden);
    if (visible.length === 0) return;
    const at = visible.indexOf(document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    visible[(at + step + visible.length) % visible.length].focus();
  });

  document.body.appendChild(panel);
  runFilter();
  // Applying re-renders the view; reopen so the menu does not blink shut
  // under the pointer after every pick.
  if (panelOpen) open(false);

  const box = el('div', 'ggt-picker');
  box.appendChild(button);
  return box;
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
 *   private, privateFresh, onToggleFresh,
 *   branches, selected, defaultBranch, truncated, canFetch, onSelectBranches }
 */
export function render(container, model) {
  const {
    owner, repo, commits, graph, heads, tags, fresh, filtered, hasMore,
    total, loaded, olderCount, failedWindows, onLoadOlder, onRefresh,
    private: priv, privateFresh, onToggleFresh, branches, selected, truncated = [],
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
      `${heads.length} of ${branches.length} ` +
      `${branches.length === 1 ? 'branch' : 'branches'} shown` +
      (tags.length > 0 ? ` · ${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}` : ''),
  );

  const actions = el('div', 'ggt-actions');
  if (branches.length > 0) actions.appendChild(buildBranchPicker(model));
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
  if (truncated.length > 0) {
    shell.appendChild(el('div', 'ggt-banner',
      `Only the tip of ${truncated.join(', ')} could be loaded — ` +
        'the dashed line marks where each branch continues below the graph.'));
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
