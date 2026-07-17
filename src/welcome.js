// Post-install welcome tour. background.js opens the demo repository with
// ?welcome#graph; once the graph has rendered, maybeWelcome() walks through
// two spotlit callouts — the new nav tab, then the graph itself. Purely
// informational: Escape or a click outside skips it, and the URL param is
// stripped at the end so refreshes stay quiet.

import { TAB_ID } from './tab.js';

const STEPS = [
  {
    target: () => document.getElementById(TAB_ID),
    pad: 6,
    title: 'Meet the Graph tab',
    body:
      'Every GitHub repository now has a Graph tab — this is the extension\'s own repo, ' +
      'and you are on its graph right now. No token, no sign-in, no setup, no backend. ' +
      'Works on any repo you have access to, public or private.',
    button: 'Next',
  },
  {
    target: () => document.querySelector('.ggt-wrap'),
    pad: 4,
    title: 'Honest Notes',
    body:
      'Getting history can take a while for some repos.\n' +
      'Private repos may show stale data.\n' +
      'For those, you can trigger a fresh fetch with the checkbox in the header.\n' +
      '\n' +
      'Still, I hope you enjoy the extension ❤️\n' +
      'Feedback is welcome directly in this repo.',
    button: 'Got it',
  },
];

let root = null;

/** Start the tour if ?welcome is in the URL. Safe to call on every render. */
export function maybeWelcome() {
  if (root !== null || !new URLSearchParams(location.search).has('welcome')) return;
  document.documentElement.style.overflow = 'hidden'; // modal: freeze scroll
  addEventListener('keydown', onKey);
  show(0);
}

function onKey(event) {
  if (event.key === 'Escape') finish();
}

function show(index) {
  const step = STEPS[index];
  const target = step.target();
  if (!target) return finish();
  const rect = target.getBoundingClientRect();
  // Cap the spotlight so the card below it always fits in the viewport.
  const height = Math.min(rect.height, Math.max(120, innerHeight - rect.top - 200));

  root?.remove();
  root = document.createElement('div');
  root.className = 'ggt-welcome';
  root.addEventListener('click', (event) => {
    if (event.target === root) finish();
  });

  const spot = document.createElement('div');
  spot.className = 'ggt-welcome-spot';
  Object.assign(spot.style, {
    top: rect.top - step.pad + 'px',
    left: rect.left - step.pad + 'px',
    width: rect.width + 2 * step.pad + 'px',
    height: height + 2 * step.pad + 'px',
  });

  const card = document.createElement('div');
  card.className = 'ggt-welcome-card';
  const cardGap = 12;
  const cardHeight = 140; // 16 padding + 14 title + 6 gap + ~90 body + 12 gap + 28 footer + 16 padding
  const cardTop = Math.min(rect.top + height + step.pad + cardGap, innerHeight - cardHeight - 16);
  const cardLeft = Math.max(16, Math.min(rect.left - 8, innerWidth - 376 - 16));
  Object.assign(card.style, {
    top: cardTop + 'px',
    left: cardLeft + 'px',
  });

  const title = document.createElement('h3');
  title.textContent = step.title;
  const body = document.createElement('p');
  body.textContent = step.body;

  const foot = document.createElement('div');
  foot.className = 'ggt-welcome-foot';
  const count = document.createElement('span');
  count.className = 'ggt-welcome-count';
  count.textContent = `${index + 1} / ${STEPS.length}`;
  const button = document.createElement('button');
  button.className = 'ggt-welcome-btn';
  button.textContent = step.button;
  button.addEventListener('click', () => {
    if (index + 1 < STEPS.length) show(index + 1);
    else finish();
  });
  foot.append(count, button);

  card.append(title, body, foot);
  root.append(spot, card);
  document.body.appendChild(root);
  button.focus();
}

function finish() {
  root?.remove();
  document.documentElement.style.removeProperty('overflow');
  removeEventListener('keydown', onKey);
  const params = new URLSearchParams(location.search);
  params.delete('welcome');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
}
