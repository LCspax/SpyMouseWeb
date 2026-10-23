// Read-only reproduction of excessive pathfinding retries for unreachable goals.
import { World } from '../src/world.js';
import { Cat } from '../src/entities.js';
const world = World.fromRows(['#########', '#...#...#', '#...#...#', '#########'], 16);
let bfsCalls = 0;
const original = world.bfsToWorld.bind(world);
world.bfsToWorld = (...args) => { bfsCalls++; return original(...args); };
const cat = new Cat(24, 24, [{ x: 24, y: 24 }, { x: 104, y: 24 }], 0, world);
for (let frame = 0; frame < 600; frame++) cat.update(1 / 60, world, { x: -9999, y: -9999 });
console.log(JSON.stringify({ scenario: 'unreachable-patrol-goal', seconds: 10, bfsCalls,
  expectedMaximumWith07SecondBackoff: 15, moved: Math.hypot(cat.x - 24, cat.y - 24),
  excessiveRetries: bfsCalls > 15 }, null, 2));
