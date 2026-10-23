// Compares source entity counts with imported data without rebuilding assets.
// Differences are review candidates, not proof that every map is playable.
import fs from 'node:fs';
import path from 'node:path';

const index = JSON.parse(fs.readFileSync('assets/levels/index.json', 'utf8'));
const catProps = new Set([50,51,52,53,54,55,56,57,58,59,285]);
const differences = [], nativeMaps = [];
let sourceMaps = 0, cats = 0, nativeCats = 0;
for (const entry of index) {
  const def = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
  cats += def.cats?.length || 0;
  const routePath = `assets/levels/routes-native/${entry.id}.json`;
  if (fs.existsSync(routePath)) {
    const data = JSON.parse(fs.readFileSync(routePath, 'utf8'));
    const norm = (pts) => JSON.stringify((pts || []).map(p => [p.x, p.y]));
    const matched = (def.cats || []).filter(c => (data.routes || []).some(r =>
      Math.abs(r.tag) === Math.abs(c.tag) &&
      (c.routeMode === r.mode || (c.routeMode === 'stationary' && r.stationary === true)) &&
      norm(c.route) === norm(r.points))).length;
    nativeCats += matched;
    nativeMaps.push({ id: entry.id, num: entry.num, source: data.source, routes: data.routes?.length || 0, matchedCats: matched });
  }
  const xmlPath = path.join('com.ea.spymouse_row/files/res', entry.id, `${entry.id}.xml`);
  if (!fs.existsSync(xmlPath)) continue;
  sourceMaps++;
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const props = [...xml.matchAll(/<Vertex\s+([^>]*?)\/>/g)].map(m => {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)\s*=\s*"?(-?\d+)"?/g)].map(x => [x[1], Number(x[2])]));
    return a;
  }).filter(v => v.Flags === 10).map(v => v.Property);
  const original = { mouse: props.filter(p => p === 1).length, exits: props.filter(p => p >= 240 && p <= 243).length,
    cheese: props.filter(p => p >= 6 && p <= 10).length, cats: props.filter(p => catProps.has(p)).length };
  const imported = { mouse: def.mouseStart ? 1 : 0, exits: def.exit ? 1 : 0, cheese: def.cheeses?.length || 0, cats: def.cats?.length || 0 };
  if (Object.keys(original).some(k => original[k] !== imported[k])) differences.push({ id: entry.id, num: entry.num, original, imported });
}
console.log(JSON.stringify({ indexedMaps: index.length, sourceMaps, importedCats: cats,
  nativeRouteMaps: nativeMaps, exactNativeRouteCatMatches: nativeCats,
  countDifferenceMaps: differences.length, differences,
  limitations: ['Entity counts alone cannot prove position or route accuracy.',
    'A route extracted from screenshots still requires visual and timing validation.',
    'Existing test-levels records cat proximity but does not fail when caught.',
    'This audit never rebuilds or modifies imported assets.'] }, null, 2));
