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
// Structure and metrics are GitHub's SelectPanel — the control behind its
// repository and branch dropdowns — measured off the live component rather
// than guessed: a 320px/12px-radius overlay holding a header (8px 8px 0, a
// 14px/21px 600 title), a filter row (a 304x32 muted input with 8px margin
// and 6px radius), and a list (8px 0 padding, rows 32px tall at 0 8px with a
// 6px radius, whose content sits at 6px 8px behind a 16px selection slot and
// a 16px leading visual, each with 8px to its right).
//
// Those numbers are hard-coded here rather than borrowed through Primer's
// class names, because GitHub code-splits its CSS: on a plain repository page
// none of the `prc-ActionList-*` / `prc-SelectPanel-*` rules are loaded at
// all (checked — every one of them missing until GitHub's own picker mounts).
// Carrying the class names looked right only when the chunk happened to be
// there, and would fight our own rules when it was. The `data-component`
// attributes are kept: they carry no styling, and they say what each part is.
//
// The two bulk actions live in the header as a Primer SegmentedControl
// ("Default | All"), not as rows in the list: they act on the whole list, so
// putting them at the same level as the branches they control read as a
// mistake — and GitHub itself puts the one switch its branch panel has
// (Branches | Tags) above the list, never inside it. Two named segments also
// avoid the lie a select-all checkbox would tell here: a graph has to draw
// at least one branch, so "unchecked" has no honest meaning. Hand-picking
// leaves neither segment active, which is exactly what "custom" looks like.
//
// Two behaviours matter beyond the looks:
//
//   - The overlay is fixed-positioned on document.body, anchored to the
//     button. Inside the graph shell it would be part of the toolbar's layout
//     and clipped by the shell's overflow.
//   - A click applies straight away. No Apply and no close button: the two
//     rows at the top are the bulk actions, and an outside click or Escape
//     closes the menu.
//
// The stylesheet is injected from here rather than shipped in style.css: the
// manifest injects that one and only refreshes it when the extension is
// reloaded, while these modules are re-read on every page load, so after an
// update the JS would otherwise run against last version's CSS.
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

const UI_STYLE_ID = 'ggt-ui-style';
const UI_CSS = `
.ggt-panel { position: fixed; z-index: 1000; display: flex; flex-direction: column; width: ${PANEL_WIDTH}px;
  font-size: 14px; line-height: 21px; color: var(--fgColor-default, #1f2328);
  background: var(--overlay-bgColor, var(--bgColor-default, #fff)); border-radius: 12px;
  box-shadow: var(--borderColor-default, rgba(209,217,224,.25)) 0 0 0 1px, rgba(37,41,46,.04) 0 6px 12px -3px, rgba(37,41,46,.12) 0 6px 18px 0; }
.ggt-panel[hidden] { display: none; }
.ggt-panel[aria-busy="true"] { pointer-events: none; }

.ggt-sp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 0 16px; }
.ggt-sp-title { margin: 0; font-size: 14px; line-height: 21px; font-weight: 600; }

/* Primer SegmentedControl, size=small, copied from the one GitHub renders
   for Preview | Code | Blame on a blob page and measured there: a 28px track
   (bg --controlTrack-bgColor-rest, 1px border, 6px radius) whose items carry
   a 1x12px divider on their right edge, and whose knob is the Content span —
   selected it is white with a 1px border, 6px radius and 0 12px padding;
   unselected it is transparent, 4px radius and 0 8px padding inside a button
   with 4px of its own. Text is 14px/21px 400 in both states. */
.ggt-seg { display: inline-flex; margin: 0; padding: 0; list-style: none; height: 28px; box-sizing: border-box;
  background: var(--controlTrack-bgColor-rest, #e6eaef); border: 1px solid var(--controlTrack-borderColor-rest, #d1d9e0); border-radius: 6px; }
.ggt-seg-item { position: relative; display: inline-flex; margin: -1px 1px -1px 0; list-style: none; }
.ggt-seg-item:first-child { margin-left: -1px; }
/* The hairline between neighbours, hidden on either side of the knob. */
.ggt-seg-item::after { content: ""; position: absolute; top: 8px; bottom: 8px; right: -2px; width: 1px;
  background: var(--borderColor-default, #d1d9e0); }
.ggt-seg-item:last-child::after,
.ggt-seg-item[data-selected]::after,
.ggt-seg-item[data-selected] + .ggt-seg-item::after { background: transparent; }
.ggt-seg-btn { display: inline-block; height: 28px; padding: 4px; font: inherit; color: var(--fgColor-default, #1f2328);
  background: none; border: 0; border-radius: 6px; cursor: pointer; }
.ggt-seg-item[data-selected] .ggt-seg-btn { padding: 0; }
.ggt-seg-content { display: flex; align-items: center; justify-content: center; height: 100%; padding: 0 8px;
  border: 1px solid transparent; border-radius: 4px; box-sizing: border-box; }
.ggt-seg-item[data-selected] .ggt-seg-content { padding: 0 12px; background: var(--controlKnob-bgColor-rest, #fff);
  border-color: var(--controlKnob-borderColor-rest, #d1d9e0); border-radius: 6px; }
.ggt-seg-text { font-size: 14px; line-height: 21px; font-weight: 400; white-space: nowrap; }
.ggt-seg-item:not([data-selected]) .ggt-seg-btn:hover .ggt-seg-content { background: var(--control-transparent-bgColor-hover, rgba(129,139,152,.15)); }
.ggt-seg-btn:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: -2px; }

.ggt-input { display: flex; align-items: center; height: 32px; margin: 8px; padding: 0 0 0 8px;
  background: var(--bgColor-muted, #f6f8fa); border: 1px solid var(--control-borderColor-rest, #d1d9e0);
  border-radius: 6px; box-sizing: border-box; }
.ggt-input:focus-within { border-color: var(--focus-outlineColor, #0969da); box-shadow: inset 0 0 0 1px var(--focus-outlineColor, #0969da); }
.ggt-input svg { flex: none; margin-right: 8px; color: var(--fgColor-muted, #59636e); }
.ggt-input input { flex: 1; min-width: 0; height: 30px; margin: 0 8px 0 0; padding: 1px 8px 1px 0;
  font: inherit; font-size: 14px; line-height: 20px; color: inherit; background: none; border: 0; outline: none; }
.ggt-input input::placeholder { color: var(--fgColor-muted, #59636e); }

.ggt-list-box { flex: 1; min-height: 0; overflow-y: auto; }
.ggt-list { margin: 0; padding: 8px 0; list-style: none; }
.ggt-item { position: relative; margin: 0 8px; border-radius: 6px; list-style: none; cursor: pointer; }
.ggt-item-content { display: flex; align-items: center; min-height: 32px; padding: 6px 8px; border-radius: 6px; box-sizing: border-box; }
/* GitHub highlights the active row with the -active token (#818b9826), not
   the -hover one (#818b981a) — measured on its own panel. */
.ggt-item:hover, .ggt-item:focus { background: var(--control-transparent-bgColor-active, rgba(129,139,152,.15)); outline: none; }
/* GitHub's active-descendant marker: a 4px accent bar pinned to the panel's
   own left edge (the row is inset by 8px, so the bar sits at -8px), 4px in
   from the row's top and bottom. It marks the row under the pointer or the
   keyboard, not the selected ones — those are the check. */
.ggt-item:hover::after, .ggt-item:focus::after { content: ""; position: absolute; left: -8px; top: 4px; bottom: 4px;
  width: 4px; background: var(--fgColor-accent, #0969da); border-radius: 6px; }
.ggt-item[aria-disabled="true"] { cursor: default; opacity: .55; }
.ggt-sel, .ggt-vis { display: flex; flex: none; align-items: center; width: 16px; height: 20px; margin-right: 8px; }
.ggt-vis { color: var(--fgColor-muted, #59636e); }
.ggt-item[aria-selected="false"] .ggt-sel svg { visibility: hidden; }
.ggt-sub { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; line-height: 20px; }
.ggt-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* GitHub's data-dividers: a hairline above every row but the first, inset to
   where the label starts. */
.ggt-item + .ggt-item .ggt-sub::before { content: ""; position: absolute; left: 48px; right: 8px; top: -1px;
  border-top: 1px solid var(--borderColor-muted, #d1d9e0); }
.ggt-pill { flex: none; padding: 0 7px; font-size: 12px; font-weight: 500; line-height: 18px; color: var(--fgColor-muted, #59636e);
  border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 2em; }
.ggt-pill-fetch { color: var(--fgColor-attention, #9a6700); border-color: var(--borderColor-attention-muted, rgba(212,167,44,.4)); }
.ggt-list-empty { padding: 6px 16px 10px; color: var(--fgColor-muted, #59636e); list-style: none; }

.ggt-select-btn { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; font: inherit; font-size: 14px;
  font-weight: 500; color: var(--button-default-fgColor-rest, #25292e); background: var(--button-default-bgColor-rest, #f6f8fa);
  border: 1px solid var(--button-default-borderColor-rest, #d1d9e0); border-radius: 6px; white-space: nowrap; cursor: pointer; }
.ggt-select-btn:hover { background: var(--button-default-bgColor-hover, #eff2f5); }
.ggt-select-btn svg { flex: none; color: var(--fgColor-muted, #59636e); }
.ggt-counter { padding: 0 6px; font-size: 12px; font-weight: 500; line-height: 18px; color: var(--fgColor-default, #1f2328);
  background: var(--bgColor-neutral-muted, rgba(129,139,152,.12)); border-radius: 2em; }
.ggt-select-btn:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: -2px; }

/* Picking a branch takes a round trip and then replaces the whole view.
   Without this the graph sits there looking untouched and then blinks into a
   different shape; with it the click reads as work in progress and the new
   graph fades up out of the dim rather than cutting. */
.ggt-shell { position: relative; }
.ggt-shell.ggt-busy .ggt-wrap, .ggt-shell.ggt-busy .ggt-footer { opacity: .5; transition: opacity .12s ease-out; }
.ggt-busy-bar { position: absolute; left: 0; right: 0; top: 0; height: 2px; overflow: hidden; background: var(--bgColor-neutral-muted, rgba(129,139,152,.12)); }
.ggt-busy-bar::after { content: ""; position: absolute; inset: 0; width: 40%; background: var(--fgColor-accent, #0969da);
  border-radius: 2px; animation: ggt-slide 1.1s ease-in-out infinite; }
@keyframes ggt-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
.ggt-spinner { display: inline-block; width: 16px; height: 16px; box-sizing: border-box; border: 2px solid currentColor;
  border-top-color: transparent; border-radius: 50%; animation: ggt-spin .7s linear infinite; }
@keyframes ggt-spin { to { transform: rotate(360deg); } }
.ggt-fade-in { animation: ggt-fade .16s ease-out; }
/* Picks up where the busy dim left off. Starting from 0 would blank the
   frame for an instant, which is the flash this is meant to remove. */
@keyframes ggt-fade { from { opacity: .5; } to { opacity: 1; } }
`;

function ensureUiStyle() {
  if (document.getElementById(UI_STYLE_ID)) return;
  const style = el('style');
  style.id = UI_STYLE_ID;
  style.textContent = UI_CSS;
  document.head.appendChild(style);
}

/**
 * Show that a pick is being fetched, without taking the graph away: the
 * anchor button spins, a progress bar rides the top of the frame and the
 * rows dim. render() replaces the whole subtree when the data lands, so the
 * state does not have to be cleared.
 */
export function setViewBusy(container, on) {
  ensureUiStyle();
  const shell = container.querySelector('.ggt-shell');
  if (!shell) return;
  shell.classList.toggle('ggt-busy', on);
  shell.querySelector(':scope > .ggt-busy-bar')?.remove();
  if (on) shell.appendChild(el('div', 'ggt-busy-bar'));
  const button = document.querySelector('.ggt-select-btn');
  const visual = button?.querySelector('[data-component="leadingVisual"]');
  if (!visual) return;
  button.setAttribute('data-loading', String(on));
  visual.textContent = '';
  visual.appendChild(on ? el('span', 'ggt-spinner') : octicon('git-branch'));
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
  ensureUiStyle();
  detachPanel?.();
  detachPanel = null;
  livePanel?.remove();

  const counter = el('span', 'ggt-counter', `${selected.size}/${branches.length}`);
  const button = el('button', 'ggt-select-btn');
  button.type = 'button';
  button.setAttribute('data-component', 'Button');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.title = 'Choose which branches the graph draws';
  const leading = el('span', 'ggt-btn-visual');
  leading.setAttribute('data-component', 'leadingVisual');
  leading.appendChild(octicon('git-branch'));
  button.append(leading, el('span', null, 'Branches'), counter, octicon('triangle-down'));

  const panel = el('div', 'ggt-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Select branches');
  livePanel = panel;

  const head = el('div', 'ggt-sp-head');
  head.setAttribute('data-component', 'SelectPanel.Header');
  const title = el('h2', 'ggt-sp-title', 'Select branches');
  title.setAttribute('data-component', 'SelectPanel.Title');
  head.appendChild(title);
  panel.appendChild(head);

  const inputWrap = el('span', 'ggt-input');
  inputWrap.setAttribute('data-component', 'TextInput');
  inputWrap.appendChild(octicon('search'));
  const filter = el('input');
  filter.type = 'text';
  filter.placeholder = 'Find a branch...';
  filter.setAttribute('data-component', 'input');
  filter.setAttribute('aria-label', 'Filter branches');
  filter.value = panelFilter;
  inputWrap.appendChild(filter);
  const filterRow = el('div');
  filterRow.setAttribute('data-component', 'FilteredActionList.Header');
  filterRow.appendChild(inputWrap);
  panel.appendChild(filterRow);

  const listBox = el('div', 'ggt-list-box');
  const list = el('ul', 'ggt-list');
  list.setAttribute('data-component', 'ActionList');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-multiselectable', 'true');
  list.setAttribute('aria-label', 'Branches');
  listBox.appendChild(list);
  panel.appendChild(listBox);

  let busy = false;
  async function apply(names, row) {
    if (busy) return;
    busy = true;
    panel.setAttribute('aria-busy', 'true');
    row?.classList.add('ggt-item-busy');
    await onSelectBranches(names);
    // The re-render replaces this control; nothing to restore here.
  }

  // One ActionList.Item: selection slot, leading visual, label, optional pill.
  function addRow({ label, on, tag, tagClass, tagTitle, disabled, onPick }) {
    const item = el('li', 'ggt-item');
    item.setAttribute('data-component', 'ActionList.Item');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(on));
    item.tabIndex = -1;
    const content = el('div', 'ggt-item-content');
    const selection = el('span', 'ggt-sel');
    selection.setAttribute('data-component', 'ActionList.Selection');
    selection.appendChild(octicon('check'));
    const visual = el('span', 'ggt-vis');
    visual.setAttribute('data-component', 'ActionList.LeadingVisual');
    visual.appendChild(octicon('git-branch'));
    const sub = el('span', 'ggt-sub');
    sub.setAttribute('data-component', 'ActionList.Item--DividerContainer');
    const name = el('span', 'ggt-label', label);
    name.setAttribute('data-component', 'ActionList.Item.Label');
    sub.appendChild(name);
    if (tag) {
      const pill = el('span', `ggt-pill${tagClass ? ' ' + tagClass : ''}`, tag);
      pill.setAttribute('data-component', 'Label');
      if (tagTitle) pill.title = tagTitle;
      sub.appendChild(pill);
    }
    content.append(selection, visual, sub);
    item.appendChild(content);
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

  // The scope switch: the only two settings worth one click, in the header
  // where a control over the whole list belongs. A branch that cannot be
  // pulled in is not part of "All", or the segment could never look active.
  const names = branches.map((branch) => branch.name);
  const pickable = branches.filter((branch) => branch.loaded || canFetch).map((b) => b.name);
  const hasDefault = defaultBranch && names.includes(defaultBranch);
  if (hasDefault) {
    const isDefaultOnly = selected.size === 1 && selected.has(defaultBranch);
    const isAll = pickable.length > 0 && pickable.every((name) => selected.has(name));
    const seg = el('ul', 'ggt-seg');
    seg.setAttribute('data-component', 'SegmentedControl');
    seg.setAttribute('data-size', 'small');
    seg.setAttribute('aria-label', 'Branch scope');
    const segment = (label, active, names_, title_) => {
      const item = el('li', 'ggt-seg-item');
      item.setAttribute('data-component', 'SegmentedControl.Button');
      if (active) item.setAttribute('data-selected', '');
      const btn = el('button', 'ggt-seg-btn');
      btn.type = 'button';
      btn.title = title_;
      btn.setAttribute('aria-pressed', String(active));
      const content = el('span', 'ggt-seg-content');
      // data-text reserves the width the label would take, so switching
      // segments cannot shift the control — Primer's own trick.
      const text = el('div', 'ggt-seg-text', label);
      text.setAttribute('data-text', label);
      content.appendChild(text);
      btn.appendChild(content);
      // Re-applying the setting already in force would only cost a fetch.
      if (!active) btn.addEventListener('click', () => apply(names_, null));
      item.appendChild(btn);
      seg.appendChild(item);
    };
    segment('Default', isDefaultOnly, [defaultBranch], `Draw only ${defaultBranch}`);
    segment('All', isAll, pickable, 'Draw every branch');
    head.appendChild(seg);
  }

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

  const empty = el('div', 'ggt-list-empty', 'No branches match.');
  empty.hidden = true;
  listBox.appendChild(empty);

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
  // nothing about where the menu lands may depend on a stylesheet's timing.
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
  ensureUiStyle();
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
  // One swap, then a short fade: the row count and the frame's height change
  // with every pick, and a hard cut through that reads as a flash.
  root.classList.add('ggt-fade-in');
  const scrollY = window.scrollY;
  container.textContent = '';
  container.appendChild(root);
  if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY });
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
