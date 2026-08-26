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
// This is GitHub's own repository dropdown, reused rather than imitated: the
// markup below carries the Primer React class names (prc-Overlay, the
// TextInput wrapper, prc-ActionList with its selection slot, prc-Label) so
// GitHub's stylesheet — already loaded on every repo page — styles it, and it
// tracks GitHub's look automatically. Two things matter beyond the looks:
//
//   - The overlay is fixed-positioned on document.body, anchored to the
//     button. Inside the graph shell it would be part of the toolbar's layout
//     and clipped by the shell's overflow; on the body it floats like
//     GitHub's own menus.
//   - A click applies straight away. No Apply and no close button: the two
//     rows at the top are the bulk actions, and an outside click or Escape
//     closes the menu.
//
// Primer's hashed class names change with its releases, and the extension's
// manifest-injected stylesheet only refreshes when the extension itself is
// reloaded (the modules refresh on every page load). So the geometry the
// dropdown cannot do without — position, list reset, row layout, the
// selection check — is carried as a small stylesheet injected right here,
// from JS, which can never be stale. It is written so that when Primer's
// classes do match, Primer wins on the details (hover, dividers, colours).
//
// Applying re-renders the whole view, which rebuilds this control, so the
// open state and the filter text live at module scope and are restored.

const PANEL_WIDTH = 320;
let panelOpen = false;
let panelFilter = '';
let livePanel = null;
// Listeners the open overlay puts on document/window. A stale outside-click
// handler whose panel is already detached sees every click as "outside" and
// shuts the new menu, so the previous instance has to hand these back.
let detachPanel = null;

// Primer React's class names, verbatim from github.com. If GitHub renames
// one, that element falls back to the ggt-* rules below — the layout holds,
// only the finer Primer polish is lost until the name is updated here.
const PRC = {
  overlay: 'prc-Overlay-Overlay-jfs-T',
  heading: 'prc-Heading-Heading-MtWFE',
  inputWrap: 'TextInput-wrapper prc-components-TextInputWrapper-Hpdqi prc-components-TextInputBaseWrapper-wY-n0',
  input: 'prc-components-Input-IwWrt',
  list: 'prc-ActionList-ActionList-rPFF2',
  item: 'prc-ActionList-ActionListItem-So4vC',
  content: 'prc-ActionList-ActionListContent-KBb8-',
  spacer: 'prc-ActionList-Spacer-4tR2m',
  selection: 'prc-ActionList-LeadingAction-hbWbh prc-ActionList-VisualWrap-bdCsS',
  checkmark: 'prc-ActionList-SingleSelectCheckmark-zMd8d',
  leading: 'prc-ActionList-LeadingVisual-NBr28 prc-ActionList-VisualWrap-bdCsS',
  sub: 'prc-ActionList-ActionListSubContent-gKsFp',
  label: 'prc-ActionList-ItemLabel-81ohH',
  pill: 'prc-Label-Label-qG-Zu',
  button: 'prc-Button-ButtonBase-9n-Xk',
  buttonContent: 'prc-Button-ButtonContent-Iohp5',
  buttonVisual: 'prc-Button-Visual-YNt2F prc-Button-VisualWrap-E4cnq',
  buttonLabel: 'prc-Button-Label-FWkx3',
};

const PICKER_STYLE_ID = 'ggt-picker-style';
const PICKER_CSS = `
.ggt-panel { position: fixed; z-index: 1000; width: ${PANEL_WIDTH}px; display: flex; flex-direction: column;
  font-size: 14px; color: var(--fgColor-default, #1f2328);
  background: var(--overlay-bgColor, var(--bgColor-default, #fff)); border-radius: 12px;
  box-shadow: var(--borderColor-default, rgba(209,217,224,.25)) 0 0 0 1px, rgba(37,41,46,.04) 0 6px 12px -3px, rgba(37,41,46,.12) 0 6px 18px 0; }
.ggt-panel[hidden] { display: none; }
.ggt-panel:not([hidden]) { opacity: 1; visibility: visible; }
.ggt-panel[aria-busy="true"] { pointer-events: none; }
.ggt-panel-head { display: flex; align-items: center; min-height: 40px; padding: 8px 16px 4px; }
.ggt-panel-head h2 { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
.ggt-panel-filter { padding: 4px 16px 8px; }
.ggt-panel-filter > span { display: inline-flex; align-items: center; width: 100%; min-height: 32px; padding: 0 12px; gap: 8px;
  background: var(--bgColor-default, #fff); border: 1px solid var(--control-borderColor-rest, #d1d9e0); border-radius: 6px; box-sizing: border-box; }
.ggt-panel-filter > span:focus-within { border-color: var(--focus-outlineColor, #0969da); box-shadow: inset 0 0 0 1px var(--focus-outlineColor, #0969da); }
.ggt-panel-filter svg { color: var(--fgColor-muted, #59636e); flex: none; }
.ggt-panel-filter input { flex: 1; min-width: 0; padding: 0; font: inherit; font-size: 14px; color: inherit; background: none; border: 0; outline: none; }
.ggt-panel ul { flex: 1; min-height: 0; margin: 0; padding: 8px; overflow-y: auto; list-style: none; }
.ggt-panel li[role="option"] { position: relative; display: block; list-style: none; border-radius: 6px; cursor: pointer; }
.ggt-panel li[role="option"] > div { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 6px 8px; box-sizing: border-box; }
.ggt-panel li[role="option"]:hover, .ggt-panel li[role="option"]:focus-visible { background: var(--control-transparent-bgColor-hover, rgba(129,139,152,.12)); outline: none; }
.ggt-panel li[aria-disabled="true"] { cursor: default; opacity: .55; }
.ggt-panel li[role="option"] [data-component="ActionList.Selection"] { display: flex; flex: none; width: 16px; }
.ggt-panel li[aria-selected="false"] [data-component="ActionList.Selection"] svg { visibility: hidden; }
.ggt-panel li[role="option"] [data-component="ActionList.LeadingVisual"] { display: flex; flex: none; color: var(--fgColor-muted, #59636e); }
.ggt-panel li[role="option"] [data-component="ActionList.Item.Label"] { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ggt-panel li[role="option"] + li[role="option"] > div::before { content: ""; position: absolute; top: -1px; left: 40px; right: 8px; border-top: 1px solid var(--borderColor-muted, #d1d9e0); }
.ggt-panel li[role="separator"] { height: 1px; margin: 8px -8px; background: var(--borderColor-muted, #d1d9e0); list-style: none; }
.ggt-panel .ggt-pill { flex: none; padding: 0 7px; font-size: 12px; font-weight: 500; line-height: 18px; color: var(--fgColor-muted, #59636e);
  border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 2em; }
.ggt-panel .ggt-pill-fetch { color: var(--fgColor-attention, #9a6700); border-color: var(--borderColor-attention-muted, rgba(212,167,44,.4)); }
.ggt-panel li.ggt-item-busy [data-component="ActionList.Selection"] svg { visibility: visible; animation: ggt-pulse 1s ease-in-out infinite; }
@keyframes ggt-pulse { 50% { opacity: .25; } }
.ggt-panel .ggt-list-empty { padding: 12px 8px; color: var(--fgColor-muted, #59636e); list-style: none; }
.ggt-select-btn { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; font: inherit; font-size: 14px; font-weight: 500;
  color: var(--button-default-fgColor-rest, #25292e); background: var(--button-default-bgColor-rest, #f6f8fa);
  border: 1px solid var(--button-default-borderColor-rest, #d1d9e0); border-radius: 6px; cursor: pointer; }
.ggt-select-btn:hover { background: var(--button-default-bgColor-hover, #eff2f5); }
.ggt-select-btn > span { display: inline-flex; align-items: center; gap: 8px; }
.ggt-select-btn svg { color: var(--fgColor-muted, #59636e); }
.ggt-counter { padding: 0 6px; font-size: 12px; font-weight: 500; line-height: 18px; color: var(--fgColor-default, #1f2328);
  background: var(--bgColor-neutral-muted, rgba(129,139,152,.12)); border-radius: 2em; }
`;

function ensurePickerStyle() {
  if (document.getElementById(PICKER_STYLE_ID)) return;
  const style = el('style');
  style.id = PICKER_STYLE_ID;
  style.textContent = PICKER_CSS;
  document.head.appendChild(style);
}

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
  ensurePickerStyle();
  detachPanel?.();
  detachPanel = null;
  livePanel?.remove();

  // Anchor: Primer's default medium Button, with its content slots.
  const counter = el('span', 'ggt-counter', `${selected.size}/${branches.length}`);
  const button = el('button', `${PRC.button} ggt-select-btn`);
  button.type = 'button';
  button.setAttribute('data-component', 'Button');
  button.setAttribute('data-size', 'medium');
  button.setAttribute('data-variant', 'default');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.title = 'Choose which branches the graph draws';
  const content = el('span', PRC.buttonContent);
  content.setAttribute('data-component', 'buttonContent');
  const leading = el('span', PRC.buttonVisual);
  leading.setAttribute('data-component', 'leadingVisual');
  leading.appendChild(octicon('git-branch'));
  const text = el('span', PRC.buttonLabel, 'Branches');
  text.setAttribute('data-component', 'text');
  const trailing = el('span', PRC.buttonVisual);
  trailing.setAttribute('data-component', 'trailingVisual');
  trailing.appendChild(octicon('triangle-down'));
  content.append(leading, text, counter, trailing);
  button.appendChild(content);

  // Overlay: Primer's Overlay, with the heading and TextInput of GitHub's
  // own repository / branch pickers.
  const panel = el('div', `${PRC.overlay} ggt-panel`);
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Select branches');
  // Primer's Overlay starts transparent and its appear animation only runs
  // once this flag is set — GitHub's own pickers carry it, so it has to be
  // here too or the menu stays see-through.
  panel.setAttribute('data-component', 'AnchoredOverlay');
  panel.setAttribute('data-visibility-visible', '');
  livePanel = panel;

  const head = el('div', 'ggt-panel-head');
  const heading = el('h2', PRC.heading, 'Select branches');
  heading.setAttribute('data-component', 'Heading');
  head.appendChild(heading);
  panel.appendChild(head);

  const filterBox = el('div', 'ggt-panel-filter');
  const wrap = el('span', PRC.inputWrap);
  wrap.setAttribute('data-component', 'TextInput');
  wrap.setAttribute('data-leading-visual', 'true');
  const icon = el('span', 'TextInput-icon');
  icon.setAttribute('data-component', 'TextInput.LeadingVisual');
  icon.setAttribute('aria-hidden', 'true');
  icon.appendChild(octicon('search'));
  const filter = el('input', PRC.input);
  filter.type = 'text';
  filter.placeholder = 'Find a branch...';
  filter.setAttribute('data-component', 'input');
  filter.setAttribute('aria-label', 'Filter branches');
  filter.value = panelFilter;
  wrap.append(icon, filter);
  filterBox.appendChild(wrap);
  panel.appendChild(filterBox);

  const list = el('ul', PRC.list);
  list.setAttribute('data-component', 'ActionList');
  list.setAttribute('data-variant', 'inset');
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

  // One ActionList.Item: spacer, selection slot with the check, leading
  // visual, label, optional trailing Label pill.
  function addRow({ label, on, tag, tagClass, tagTitle, disabled, onPick }) {
    const item = el('li', PRC.item);
    item.setAttribute('data-component', 'ActionList.Item');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(on));
    item.tabIndex = -1;
    const body = el('div', PRC.content);
    body.setAttribute('data-size', 'medium');
    const selection = el('span', PRC.selection);
    selection.setAttribute('data-component', 'ActionList.Selection');
    selection.appendChild(octicon('check', PRC.checkmark));
    const visual = el('span', PRC.leading);
    visual.setAttribute('data-component', 'ActionList.LeadingVisual');
    visual.appendChild(octicon('git-branch'));
    const sub = el('span', PRC.sub);
    sub.setAttribute('data-component', 'ActionList.Item--DividerContainer');
    const name = el('span', PRC.label, label);
    name.setAttribute('data-component', 'ActionList.Item.Label');
    sub.appendChild(name);
    body.append(el('span', PRC.spacer), selection, visual, sub);
    if (tag) {
      const pill = el('span', `${PRC.pill} ggt-pill${tagClass ? ' ' + tagClass : ''}`, tag);
      pill.setAttribute('data-component', 'Label');
      pill.setAttribute('data-size', 'small');
      pill.setAttribute('data-variant', tagClass ? 'attention' : 'default');
      if (tagTitle) pill.title = tagTitle;
      body.appendChild(pill);
    }
    item.appendChild(body);
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

  // Bulk actions first, as two ordinary rows — what replaces footer buttons.
  const names = branches.map((branch) => branch.name);
  const pickable = branches.filter((branch) => branch.loaded || canFetch).map((b) => b.name);
  addRow({
    label: 'All branches',
    on: selected.size === branches.length,
    onPick: (row) => apply(pickable, row),
  });
  if (defaultBranch && names.includes(defaultBranch)) {
    addRow({
      label: `Only ${defaultBranch}`,
      on: selected.size === 1 && selected.has(defaultBranch),
      onPick: (row) => apply([defaultBranch], row),
    });
  }
  const separator = el('li');
  separator.setAttribute('role', 'separator');
  list.appendChild(separator);

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
      tag: branch.name === defaultBranch ? 'default' : branch.loaded ? '' : canFetch ? 'fetch' : 'unavailable',
      tagClass: branch.name === defaultBranch ? '' : 'ggt-pill-fetch',
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
  // page scrolls under it. Set inline as well as in the injected stylesheet:
  // nothing about where the menu lands may depend on any stylesheet's timing.
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
  // Escape is watched on the document, not on the panel: picking a row
  // applies straight away and focus is usually back on the page by then.
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
    // When a pick re-renders the view, this runs before the new toolbar is
    // in the document and the button's rect is all zeros; measure again once
    // it has been attached, or the menu lands in the top-left corner.
    requestAnimationFrame(place);
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
    const visible = [...list.querySelectorAll('li[role="option"]')].filter((item) => !item.hidden);
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
