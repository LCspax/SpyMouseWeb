import fs from 'node:fs';
const root='com.ea.spymouse_row/files/res_960x640';
const files=['hud/hud_paws.png','hud/hud_paws_over.png','hud/hud_elem_left.png','hud/hud_elem_mid.png','hud/hud_elem_right.png','hud/hud_cheese_icon.png','ui/popup_pause_2.png','ui/btn_pause_continue.png','ui/btn_pause_continue_over.png','ui/btn_pause_retry.png','ui/btn_pause_retry_over.png'];
fs.mkdirSync('assets/ui',{recursive:true});
files.push('cat_silhoutte.png', 'ui/bg_death.png');
// Native PinholeManager transition art (0xaf46c cases 0/1/2/4/5/6): win uses
// pin_hole + bg_pattern, fail uses cat_silhoutte + bg_death, results pin_star.
files.push('pin_hole.png','pin_hole_black.png','pin_star.png','pin_tonsills.png','ui/bg_pattern.png');
files.push('ui/btn_pause_home.png','ui/btn_pause_home_over.png');
files.push(...['bg_bonus','results_popup','results_line','results_dashed_line','btn_results_cont','btn_results_cont_over','btn_results_retry','btn_results_retry_over'].map(name=>`ui/${name}.png`));
for(const name of fs.readdirSync(`${root}/ui/goals`).filter(name=>name.endsWith('.png'))) files.push(`ui/goals/${name}`);
files.push('ui/popup_backpack.png','ui/cards/card_dossier.png');
for(const name of files) fs.copyFileSync(`${root}/${name}`,`assets/ui/${name.split('/').pop()}`);
// Dossier cards/portraits/screenshots + folder/paper art (native id table
// 0x2af2dc; the backpack reads assets/ui/dossiers.json).
fs.mkdirSync('assets/ui/dossiers',{recursive:true});
let dossierFiles=0;
for(const name of fs.readdirSync(`${root}/ui/dossiers`).filter(name=>name.endsWith('.png'))){
  fs.copyFileSync(`${root}/ui/dossiers/${name}`,`assets/ui/dossiers/${name}`);
  dossierFiles++;
}
console.log(`Imported ${files.length} original UI assets + ${dossierFiles} dossier assets`);
