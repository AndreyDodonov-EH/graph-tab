// User-resizable column widths: drag the dividers in the column header row
// (vscode-git-graph style), double-click one to reset. Widths live in
// --ggt-col-* CSS variables so dragging restyles every row at once; only
// user-overridden columns are persisted (localStorage), so the graph
// column's default keeps following the lane count of the current render.

const KEY = 'ggt-columns';
const MIN = 40, MAX = 800;

function saved() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function persist(overrides) {
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    // storage unavailable; widths just won't stick
  }
}

/**
 * Apply saved/default widths to `root` and return a divider factory:
 * divider(id, dir) -> handle element. `dir` is +1 for columns left of the
 * flexible message column (dragging right widens) and -1 for those right
 * of it (their left edge moves, so dragging left widens).
 */
export function initColumns(root, defaults) {
  const overrides = saved();
  const widths = { ...defaults, ...overrides };
  const apply = (id) => root.style.setProperty(`--ggt-col-${id}`, widths[id] + 'px');
  Object.keys(widths).forEach(apply);

  return function divider(id, dir) {
    const grip = document.createElement('div');
    grip.className = `ggt-grip ggt-grip-${id}`;
    grip.title = 'Drag to resize · double-click to reset';
    grip.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widths[id];
      const move = (e) => {
        widths[id] = Math.round(Math.min(MAX, Math.max(MIN, startWidth + dir * (e.clientX - startX))));
        apply(id);
      };
      const up = () => {
        removeEventListener('mousemove', move);
        removeEventListener('mouseup', up);
        overrides[id] = widths[id];
        persist(overrides);
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
    grip.addEventListener('dblclick', () => {
      delete overrides[id];
      persist(overrides);
      widths[id] = defaults[id];
      apply(id);
    });
    return grip;
  };
}
