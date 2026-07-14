// Lane layout for a commit graph, following the classic `git log --graph`
// model (see also vscode-git-graph's Graph class): walk commits newest-first
// and keep a list of active lanes, each waiting for the sha it must reach
// next. Lanes are released when their commit is emitted and reused for later
// branches, merges join the existing lane of their target when one is open,
// and octopus merges (3+ parents) fall out of the same per-parent loop.
//
// Pure and DOM-free so it can be unit-tested in Node.

/**
 * @param {Array<{oid: string, parents: string[]}>} commits newest-first;
 *   children must appear before their parents (GitHub's network order,
 *   reversed, guarantees this). Parents outside the array are tolerated and
 *   produce dashed tail segments at the bottom of the graph.
 * @returns {{
 *   nodes: Array<{row: number, x: number, color: number}>,   // per commit, same order
 *   segments: Array<{x1: number, y1: number, x2: number, y2: number, color: number, dashed?: boolean}>,
 *   laneCount: number
 * }} coordinates are in grid units: x in lanes, y in rows.
 */
export function layout(commits) {
  const lanes = []; // per lane: null or { sha, color, bornAtX?, lastSeg? }
  let joins = [];   // merge edges waiting for their next-row anchor: { fromX, sha }
  const nodes = [];
  const segments = [];
  let nextColor = 0;
  let laneCount = 0;

  const findLane = (sha) => lanes.findIndex((lane) => lane !== null && lane.sha === sha);
  const freeLane = () => {
    const k = lanes.indexOf(null);
    return k === -1 ? lanes.length : k;
  };

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];

    // Where this commit sits: the leftmost lane waiting for it, or a free
    // lane when it is a branch tip.
    let x = findLane(commit.oid);
    let color;
    if (x === -1) {
      x = freeLane();
      color = nextColor++;
    } else {
      color = lanes[x].color;
    }

    // Emit the edges from the previous row into this one. Lanes waiting for
    // this commit bend into its node; everything else continues straight
    // down. Consecutive straight segments of an untouched lane are coalesced.
    if (row > 0) {
      const y1 = row - 1;
      for (let k = 0; k < lanes.length; k++) {
        const lane = lanes[k];
        if (!lane) continue;
        const x1 = lane.bornAtX !== undefined ? lane.bornAtX : k;
        const x2 = lane.sha === commit.oid ? x : k;
        delete lane.bornAtX;
        const straight = x1 === k && x2 === k;
        if (straight && lane.lastSeg && lane.lastSeg.y2 === y1) {
          lane.lastSeg.y2 = row;
        } else {
          const seg = { x1, y1, x2, y2: row, color: lane.color };
          segments.push(seg);
          lane.lastSeg = straight ? seg : null; // only vertical runs may extend
        }
      }
      for (const join of joins) {
        const target = findLane(join.sha);
        const x2 = join.sha === commit.oid ? x : target;
        segments.push({ x1: join.fromX, y1, x2, y2: row, color: lanes[target].color });
      }
      joins = [];
    }

    nodes.push({ row, x, color });

    // Release every lane that was waiting for this commit.
    for (let k = 0; k < lanes.length; k++) {
      if (lanes[k] !== null && lanes[k].sha === commit.oid) lanes[k] = null;
    }

    // The first parent continues this commit's branch in the same lane.
    const parents = commit.parents;
    if (parents.length > 0) {
      lanes[x] = { sha: parents[0], color };
    }

    // Remaining parents (merge sources): join the lane already waiting for
    // that sha when one is open, otherwise start a new lane from this node.
    for (let p = 1; p < parents.length; p++) {
      const sha = parents[p];
      if (findLane(sha) !== -1) {
        joins.push({ fromX: x, sha });
      } else {
        const k = freeLane();
        lanes[k] = { sha, color: nextColor++, bornAtX: x };
      }
    }

    laneCount = Math.max(laneCount, x + 1, lanes.length);
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
  }

  // Parents that never arrived (outside the fetched window): dashed tails so
  // the graph honestly shows the history continues below.
  const y1 = commits.length - 1;
  const y2 = commits.length - 0.5;
  for (let k = 0; k < lanes.length; k++) {
    const lane = lanes[k];
    if (!lane) continue;
    const x1 = lane.bornAtX !== undefined ? lane.bornAtX : k;
    segments.push({ x1, y1, x2: k, y2, color: lane.color, dashed: true });
  }
  for (const join of joins) {
    const target = findLane(join.sha);
    segments.push({ x1: join.fromX, y1, x2: target, y2, color: lanes[target].color, dashed: true });
  }

  return { nodes, segments, laneCount };
}
