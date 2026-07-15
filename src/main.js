// Entry point: keep the Graph tab present on repo pages across GitHub's
// soft (turbo/React) navigations, and swap the repo content for the graph
// view when the tab is clicked.

import { ensureTab, markTabSelected, repoNav, TAB_ID } from './tab.js';
import { openRepoGraph } from './data.js';
import { layout } from './layout.js';
import { render, renderStatus } from './render.js';

const VIEW_ID = 'ggt-view';

// GitHub's non-repository top-level routes; everything else shaped like
// /{owner}/{repo} is treated as a repo (the nav lookup is the real gate).
const RESERVED = new Set([
  'settings', 'notifications', 'explore', 'marketplace', 'sponsors', 'topics',
  'collections', 'trending', 'features', 'organizations', 'orgs', 'enterprises',
  'login', 'logout', 'join', 'signup', 'new', 'codespaces', 'search', 'pulls',
  'issues', 'dashboard', 'apps', 'account', 'about', 'contact', 'pricing',
]);

let source = null;    // data source for the current repo
let hidden = [];      // elements we hid to show the view; restored on close
let lastPath = null;

function repoFromPath() {
  const [owner, repo] = location.pathname.split('/').filter(Boolean);
  if (!owner || !repo || RESERVED.has(owner)) return null;
  return { owner, repo };
}

function contentFrame() {
  return (
    document.querySelector('turbo-frame#repo-content-turbo-frame') ||
    document.querySelector('#js-repo-pjax-container') ||
    document.querySelector('main')
  );
}

function closeGraphView() {
  document.getElementById(VIEW_ID)?.remove();
  for (const element of hidden) {
    if (element.isConnected) element.style.removeProperty('display');
  }
  hidden = [];
}

function openGraphView() {
  const repoRef = repoFromPath();
  const frame = contentFrame();
  if (!repoRef || !frame) return;

  markTabSelected();

  let view = document.getElementById(VIEW_ID);
  if (!view) {
    view = document.createElement('div');
    view.id = VIEW_ID;
    if (frame.tagName === 'MAIN') {
      // Hiding <main> could hide the nav itself; hide its children instead.
      hidden = [...frame.children].filter((child) => child.style.display !== 'none');
      frame.appendChild(view);
    } else {
      hidden = [frame];
      frame.before(view);
    }
    for (const element of hidden) element.style.display = 'none';
  }

  loadAndRender(view, repoRef);
}

async function loadAndRender(view, repoRef) {
  try {
    if (!source || source.owner !== repoRef.owner || source.repo !== repoRef.repo) {
      renderStatus(view, 'Loading commit graph…');
      source = await openRepoGraph(repoRef.owner, repoRef.repo);
    }
    rerender(view);
  } catch (error) {
    source = null;
    renderStatus(view, String(error.message || error), true);
  }
}

function rerender(view) {
  const { commits, filtered } = source.view();
  render(view, {
    owner: source.owner,
    repo: source.repo,
    commits,
    graph: layout(commits),
    heads: source.heads,
    fresh: source.fresh,
    filtered,
    hasMore: source.hasMore(),
    onLoadOlder: async () => {
      await source.loadOlder();
      rerender(view);
    },
  });
}

// Runs on every DOM settle: detects soft navigation (path change closes the
// view and drops the per-repo source) and re-adds the tab when GitHub
// re-renders the nav.
function ensure() {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    closeGraphView();
    source = null;
  }
  if (repoFromPath() && !document.getElementById(TAB_ID) && repoNav()) {
    ensureTab(openGraphView);
  }
}

let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    ensure();
  });
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('turbo:load', ensure);
ensure();
