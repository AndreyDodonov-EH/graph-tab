# Graph Tab for GitHub

![Graph Tab demo](img/graphtab.gif)


A standalone Chrome extension that adds a **Graph** tab to GitHub repository
pages and renders the commit graph. It needs **no token, no OAuth, and no
extension permissions**: same-origin fetches from the content script ride the
user's existing github.com session cookie, so any repo you can view in the
browser (public, private, org) works without any setup.


## Install
`WIP, extension store publish pending`
Install from the extension store. Just search for "graph tab".
Works on Chrome and Edge, Firefox is WiP.

## Install for developers (unpacked)

1. `chrome://extensions` → enable *Developer mode*
2. *Load unpacked* → select this directory
3. Open any repository on github.com → click the **Graph** tab

## How it works

- **Data** (`src/data.js`): GitHub's undocumented network-graph endpoints
  (`/{owner}/{repo}/network/meta` + `network/chunk`; the chunk `end` bound is
  inclusive, checked against the live API), fetched newest-window first,
  paginated by the "Load older commits" footer. The endpoints return the entire
  fork network with interleaved commits, so the focused repository is isolated
  by **reachability** from `meta.users[0].heads` (author/owner/block filtering
  gives wrong results, see the findings doc).
- **Freshness** (`src/gitproto.js`, `src/webfresh.js`): the network-graph
  snapshot lags pushes by minutes to hours, so branch heads are re-read live
  and missing commits spliced in. Public repos: git smart-HTTP v2 on
  `/{owner}/{repo}.git` (ls-refs + a `tree:0`-filtered fetch, parsed by an
  own pack reader and RFC-1951 inflater). The same ls-refs call also returns
  tags (`peel` resolves annotated tags to their commits), rendered as dashed
  chips next to the branch chips. Private repos reject anonymous git,
  so an opt-in header checkbox ("fetch fresh commits") walks
  `/latest-commit/{ref}` and `/commit/{oid}` (as JSON via `Accept`) instead,
  and resolves tags through `/refs?type=tag` + `/latest-commit/{tag}`.
  That costs one request per missing commit (and per tag, capped), which is
  why it is off by default.
  Fetched commits are immutable, so they are cached (localStorage, keyed by
  oid) and never re-fetched.
- **Branches** (`src/branches.js`, the header picker): which branches the
  graph draws is a choice, because a branch outside the snapshot window costs
  a request to pull in and not everyone wants every `dependabot/*` line. The
  default is free: the default branch (`HEAD`'s symref target from ls-refs, or
  the `defaultBranch` the repo page embeds) plus every branch the window
  already holds — the old behaviour, at the old cost. Ticking more branches
  fetches just their tips (`want` + a small `deepen`, deliberately **no**
  `have` lines: the loaded window is a slice of the network array, not an
  ancestor-closed set, so promising it as "have" makes the server negotiate
  everything away and answer with an empty pack). A branch that reaches back
  further than the fetch is drawn as a stub with a dashed tail rather than
  hidden, the way `git log --graph --all` shows a shallow or unrelated
  history. Choices are remembered per repository.
- **Ordering** (`src/order.js`): the network array's absolute position is a
  date axis, so commits spliced in from git or the commit pages are placed on
  it by their own date (`chronoIndex`) rather than stacked on top. Dates alone
  cannot guarantee a child stays above its parent, so the final row order is
  decided topologically and uses the date only to choose between commits that
  are ready — which is also what makes two histories with nothing in common
  interleave sanely instead of fighting over the lanes.
- **Layout** (`src/layout.js`): pure, DOM-free lane assignment following the
  classic `git log --graph` / vscode-git-graph model: lane reservation and
  release, merge edges that join already-open lanes, octopus merges, and
  dashed tails for parents that live below the loaded window.
- **Rendering** (`src/render.js`): one SVG behind fixed-height HTML rows,
  cubic-bezier lane transitions, a stable 12-color palette, and GitHub CSS
  variables for the chrome so light/dark themes both work.
- **Integration** (`src/tab.js`, `src/main.js`): the nav tab is built from
  scratch (not cloned from GitHub markup) and kept alive across soft
  navigations by a debounced MutationObserver + `turbo:load`. The view is
  URL-driven: the tab pushes `#graph` and the view opens/closes purely from
  `location`, so refresh, back/forward, and pasted links all work (a hash,
  unlike a real path, never reaches the server, so nothing can 404).

No build step: `loader.js` dynamic-imports `src/main.js` as an ES module.

## How it was built

Built with Codex (GPT 5.6), which unblocked the three problems that stopped
existing extensions:

- **Authentication**: asking users for a token or OAuth was never an option
  for an extension. Codex, using Playwright and `gh api`, found GitHub's
  undocumented network-graph endpoints, so the extension needs no permissions
  and no token.
- **Stale data**: fresh commits are fetched live over the git smart protocol.
- **Imperfect visuals**: it took a lot of iteration and testing to get the
  graph rendering right.

## Tests

```
node --test tests/*.test.mjs
```

Layout is a pure function, so the graph geometry (lanes, colors, merge joins,
coalesced straight runs, dangling tails) is asserted directly; network code
is tested by stubbing `globalThis.fetch`.


## Deployment

`package.sh` can be used to create a zip for the browser extension store