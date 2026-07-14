// The "Graph" item in the repository navigation bar. Built from scratch and
// styled by our own CSS (no cloning of GitHub's tab markup), so it survives
// GitHub's CSS-module class churn; only the nav container is looked up.

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

/** Insert the Graph tab into the repo nav if missing. Returns the anchor. */
export function ensureTab(onOpen) {
  const existing = document.getElementById(TAB_ID);
  if (existing) return existing;
  const nav = repoNav();
  if (!nav) return null;

  const item = document.createElement('li');
  item.className = 'ggt-navitem';

  const link = document.createElement('a');
  link.id = TAB_ID;
  link.className = 'ggt-navtab';
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
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATH);
  icon.appendChild(path);

  link.appendChild(icon);
  link.appendChild(document.createTextNode('Graph'));
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
