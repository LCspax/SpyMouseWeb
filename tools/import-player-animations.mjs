import fs from 'node:fs';
const root = 'com.ea.spymouse_row/files';
const attrs = text => Object.fromEntries([...text.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const sequences = {};
for (const name of ['idle', 'idle_scratch', 'player_checkmap', 'player_sniff', 'player_yoyo', 'player_juggle']) {
  const xml = fs.readFileSync(`${root}/res/anim_sequences/${name}.xml`, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const animation = attrs(xml.match(/<Animation\s+([^>]+)>/)[1]);
  const file = animation.image.split('/').pop();
  fs.copyFileSync(`${root}/res_960x640/sprites/${file}`, `assets/sprites/${file}`);
  for (const match of xml.matchAll(/<Sequence\s+([^>]+)>([\s\S]*?)<\/Sequence>/g)) {
    const sequence = attrs(match[1]);
    const frames = [...match[2].matchAll(/<Frame\s+([^>]+)\/>/g)].map(m => {
      const a = attrs(m[1]);
      return { cx: +a.cx, cy: +a.cy, ms: +a.delay * 1000, ox: +(a.ox || 0) * 2, oy: +(a.oy || 0) * 2 };
    });
    sequences[sequence.name] = { file, fw: +animation.frameWidth * 2, fh: +animation.frameHeight * 2, frames, duration: frames.reduce((s, f) => s + f.ms, 0) };
  }
}
fs.writeFileSync('src/player-animations.js', '// Generated from shipped anim_sequences XML. Run node tools/import-player-animations.mjs.\nexport const PLAYER_SEQUENCES = ' + JSON.stringify(sequences, null, 2) + ';\n');
console.log(`Imported ${Object.keys(sequences).length} player sequences`);
