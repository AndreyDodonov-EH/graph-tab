// The "Graph" item in the repository navigation bar. The markup is our own,
// but class names are copied from a sibling tab at insert time, so the tab
// matches GitHub's current styling exactly (classic UnderlineNav and the
// logged-in React nav alike) without hardcoding churn-prone class names.
// Our own CSS (.ggt-nav*) only kicks in if there is no sibling to copy from.

export const TAB_ID = 'ggt-tab';

const NAV_SELECTORS = [
  'nav[aria-label="Repository"] ul',
  'ul[class*="UnderlineItemList"]',
  'nav[class*="LocalNavigation"] ul',
];

const ICON_PATH =
  'M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 ' +
  '2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 ' +
  '1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a' +
  '.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z';

export function repoNav() {
  for (const selector of NAV_SELECTORS) {
    const nav = document.querySelector(selector);
    if (nav) return nav;
  }
  return null;
}

// Copy presentation classes from a sibling element, skipping GitHub's
// behavior/state classes (js-* hooks, selection, icon-specific octicons).
// Returns false when nothing was copied so the caller can fall back.
function copyClasses(source, target) {
  if (!source) return false;
  const names = [...source.classList].filter(
    (name) => !name.startsWith('js-') && !name.startsWith('octicon-') && name !== 'selected'
  );
  if (names.length === 0) return false;
  target.classList.add(...names);
  return true;
}

/** Insert the Graph tab into the repo nav if missing. Returns the anchor. */
export function ensureTab(onOpen) {
  const existing = document.getElementById(TAB_ID);
  if (existing) return existing;
  const nav = repoNav();
  if (!nav) return null;

  const siblingLink = nav.querySelector('li a');
  const item = document.createElement('li');
  if (!copyClasses(siblingLink?.closest('li'), item)) item.className = 'ggt-navitem';

  const link = document.createElement('a');
  link.id = TAB_ID;
  if (!copyClasses(siblingLink, link)) link.className = 'ggt-navtab';
  link.href = '#graph';
  link.addEventListener('click', (event) => {
    event.preventDefault();
    onOpen();
  });

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('aria-hidden', 'true');
  copyClasses(siblingLink?.querySelector('svg'), icon);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATH);
  icon.appendChild(path);

  // data-content lets GitHub's CSS reserve the bold width, so the tab does
  // not shift when it becomes selected; our fallback CSS mirrors the trick.
  const label = document.createElement('span');
  copyClasses(siblingLink?.querySelector('span[data-content]'), label);
  label.setAttribute('data-content', 'Graph');
  label.textContent = 'Graph';

  link.appendChild(icon);
  link.appendChild(label);
  item.appendChild(link);
  nav.appendChild(item);
  return link;
}

/** Mark our tab current and visually deselect GitHub's own tabs. */
export function markTabSelected() {
  const tab = document.getElementById(TAB_ID);
  if (!tab) return;
  tab.setAttribute('aria-current', 'page');
  const nav = repoNav();
  if (!nav) return;
  for (const link of nav.querySelectorAll('a[aria-current]')) {
    if (link !== tab) {
      link.removeAttribute('aria-current');
      link.classList.remove('selected');
    }
  }
}
