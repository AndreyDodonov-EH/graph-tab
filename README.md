# GitHub Graph Tab

A standalone Chrome extension that adds a **Graph** tab to GitHub repository
pages and renders the commit graph — with **no token, no OAuth, and no
extension permissions**. Same-origin fetches from the content script ride the
user's existing github.com session cookie, so any repo you can view in the
browser (public, private, org) works with zero setup.

Data source and rendering direction follow the findings in
`../le-git-graph/NETWORK_GRAPH_RENDERER.md`; the code is written from scratch.

## Install (unpacked)

1. `chrome://extensions` → enable *Developer mode*
2. *Load unpacked* → select this directory
3. Open any repository on github.com → click the **Graph** tab

## How it works

- **Data** (`src/data.js`): GitHub's undocumented network-graph endpoints
  (`/{owner}/{repo}/network/meta` + `network/chunk`), fetched newest-window
  first, paginated by "Load older commits". The endpoints return the entire
  fork network with interleaved commits, so the focused repository is isolated
  by **reachability** from `meta.users[0].heads` (author/owner/block filtering
  is provably wrong — see the findings doc).
- **Layout** (`src/layout.js`): pure, DOM-free lane assignment following the
  classic `git log --graph` / vscode-git-graph model — lane reservation and
  release, merge edges that join already-open lanes, octopus merges, and
  dashed tails for parents that live below the loaded window.
- **Rendering** (`src/render.js`): one SVG behind fixed-height HTML rows,
  cubic-bezier lane transitions, a stable 12-color palette, and GitHub CSS
  variables for the chrome so light/dark themes both work.
- **Integration** (`src/tab.js`, `src/main.js`): the nav tab is built from
  scratch (not cloned from GitHub markup) and kept alive across soft
  navigations by a debounced MutationObserver + `turbo:load`.

No build step: `loader.js` dynamic-imports `src/main.js` as an ES module.

## Tests

```
node --test tests/layout.test.mjs
```

Layout is a pure function, so the graph geometry (lanes, colors, merge joins,
coalesced straight runs, dangling tails) is asserted directly.
