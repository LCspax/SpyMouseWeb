// Verification for nav-path failure backoff vs. active invalidation.
// Cases: unreachable target, restored reachability, changed target.
// Read-only; prints JSON evidence.
import { World } from "../src/world.js";
import { Cat } from "../src/entities.js";

const DT = 1 / 60;
const ROWS = ["#########", "#...#...#", "#...#...#", "#########"];

function makeWorld() {
  let calls = 0;
  const world = World.fromRows(ROWS, 16);
  const original = world.bfsToWorld.bind(world);
  world.bfsToWorld = (...args) => {
    calls += 1;
    return original(...args);
  };
  return {
    world,
    get calls() {
      return calls;
    },
  };
}

// A. unreachable target: bounded retries, no movement
{
  const w = makeWorld();
  const cat = new Cat(24, 24, [{ x: 24, y: 24 }, { x: 104, y: 24 }], 0, w.world);
  for (let i = 0; i < 600; i++) cat.update(DT, w.world, { x: -9999, y: -9999 });
  console.log(JSON.stringify({
    case: "unreachable",
    frames: 600,
    bfsCalls: w.calls,
    moved: +Math.hypot(cat.x - 24, cat.y - 24).toFixed(3),
    pass: w.calls <= 15 && Math.hypot(cat.x - 24, cat.y - 24) < 1,
  }));
}

// B. restored reachability: open the door after 300 frames
{
  const w = makeWorld();
  const world = w.world;
  const cat = new Cat(24, 24, [{ x: 24, y: 24 }, { x: 104, y: 24 }], 0, world);
  for (let i = 0; i < 300; i++) cat.update(DT, world, { x: -9999, y: -9999 });
  const before = { calls: w.calls, x: cat.x, y: cat.y };
  world.grid[1 * world.cols + 4] = 0; // open the wall between the rooms
  let minDistToGoal = Infinity;
  for (let i = 0; i < 300; i++) {
    cat.update(DT, world, { x: -9999, y: -9999 });
    minDistToGoal = Math.min(minDistToGoal, Math.hypot(104 - cat.x, 24 - cat.y));
  }
  const moved = Math.hypot(cat.x - before.x, cat.y - before.y);
  const finalDist = Math.hypot(104 - cat.x, 24 - cat.y);
  console.log(JSON.stringify({
    case: "restored",
    bfsCallsBeforeOpen: before.calls,
    bfsCallsTotal: w.calls,
    movedAfterOpen: +moved.toFixed(1),
    minDistanceToGoal: +minDistToGoal.toFixed(1),
    finalDistanceToGoal: +finalDist.toFixed(1),
    pass: w.calls <= 30 && minDistToGoal < 15,
  }));
}

// C. changed target: swap from the unreachable goal to a reachable one
{
  const w = makeWorld();
  const world = w.world;
  const cat = new Cat(24, 24, [{ x: 24, y: 24 }, { x: 104, y: 24 }], 0, world);
  for (let i = 0; i < 60; i++) cat.update(DT, world, { x: -9999, y: -9999 });
  const callsBeforeChange = w.calls;
  cat.route[1] = { x: 72, y: 24 }; // reachable point in the same room
  const x0 = cat.x, y0 = cat.y;
  for (let i = 0; i < 5; i++) cat.update(DT, world, { x: -9999, y: -9999 });
  const callsAfter5Frames = w.calls;
  let maxMoved = 0;
  for (let i = 0; i < 115; i++) {
    cat.update(DT, world, { x: -9999, y: -9999 });
    maxMoved = Math.max(maxMoved, Math.hypot(cat.x - x0, cat.y - y0));
  }
  console.log(JSON.stringify({
    case: "changed-target",
    callsBeforeChange,
    callsAfter5Frames,
    retriedImmediately: callsAfter5Frames > callsBeforeChange,
    maxMovedIn2Seconds: +maxMoved.toFixed(1),
    pass: callsAfter5Frames > callsBeforeChange && maxMoved > 10,
  }));
}
