import { World } from "./world.js";
import { LEVELS as ASCII } from "./levels.js";

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function exists(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-cache" });
    return res.ok;
  } catch {
    return false;
  }
}

function snapAll(def, world) {
  const snap = (p) => {
    const o = world.closestOpen(p.x, p.y);
    // Snapping changes navigation coordinates, never entity identity or art.
    // Dropping prop here made all cheeses default to cheese01 and every exit
    // default to _d; it also discarded authored anchors and route waits.
    return { ...p, x: o.x, y: o.y };
  };
  if (def.mouseStart) def.mouseStart = snap(def.mouseStart);
  if (def.exit) def.exit = snap(def.exit);
  if (def.cheeses) def.cheeses = def.cheeses.map(snap);
  if (def.cats) {
    for (const c of def.cats) {
      const s = snap(c);
      c.x = s.x;
      c.y = s.y;
      if (c.route) c.route = c.route.map(snap);
    }
  }
}

// Load authored level definitions (assets/levels/index.json). Falls back to the
// built-in ASCII levels when the imported content is not present.
export async function loadContent() {
  let index = null;
  try {
    index = await fetchJson("assets/levels/index.json");
  } catch {
    index = null;
  }

  if (!index || !index.length) {
    return { levels: ASCII, source: "builtin" };
  }

  const mechanisms=await fetchJson('assets/mechanisms.json').catch(()=>({}));
  const floorDefinitions=await fetchJson('assets/floors/definitions.json').catch(()=>({}));
  const results = await Promise.all(
    index.map(async (entry) => {
      try {
        const def = await fetchJson(entry.file);
        def.id = entry.id || def.id;
        def.num = entry.num || def.num;
        def.name = entry.name || def.name;
        def.theme = entry.theme || def.theme;
        def.mechanisms=mechanisms[def.id]||def.mechanisms;
        const collision=await fetchJson(`assets/collision/${def.id}.json`).catch(()=>null);
        if(collision?.segments?.length)def.collisionSegments=collision.segments;
        // Old XML import synthesized a door when the real MBN exit was outside
        // its walkable component. Keep the native identity/art and snap only
        // the interaction point, instead of showing an invented plain exit.
        if(def.mechanisms?.nativeExit&&(!def.exit||def.exit.source==='synthesized'))def.exit={...def.mechanisms.nativeExit};
        def.extraFloors=await Promise.all((floorDefinitions[def.id]||[]).map(async floor=>{
          const mask=await fetchJson(floor.mask),world=World.fromMask(mask),copy={...floor};
          const fc=await fetchJson(`assets/collision/${floor.id}.json`).catch(()=>null);
          if(fc?.segments?.length){copy.collisionSegments=fc.segments;world.setCollisionSegments(fc.segments);}
          snapAll(copy,world);copy.mask=mask;return copy;
        }));
        if(def.extraFloors.length&&def.exit?.source==='synthesized')def.exit=null;
        if (def.mask) {
          const mask = await fetchJson(def.mask);
          const world = World.fromMask(mask);
          snapAll(def, world);
          def.mask = mask;
        }
        return def;
      } catch (e) {
        console.warn("level import failed:", entry.file, e);
        return null;
      }
    })
  );
  const levels = results.filter(Boolean);
  if (!levels.length) return { levels: ASCII, source: "builtin" };
  return { levels, source: "imported" };
}

