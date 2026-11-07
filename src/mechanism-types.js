// Property identities from the shipped controllers and item help text.
import {holeColour} from './props.js';
export const ITEM_PROPS={
  12:'string',14:'chilli',16:'chilli',17:'cover',18:'balloon',19:'fish',209:'chilli2',
  // Native pickup art 0x920e0: cheese_inf frames 0..3, robodog_broken,
  // keepsake and dossier_icon. These were previously deferred.
  13:'cheese_inf',97:'cheese_inf',98:'cheese_inf',99:'cheese_inf',
  250:'robodog',330:'keepsake',431:'dossier',
};

// Switch families (native ObjControllerSwitch, vtable 0x2b2a68; see
// analysis/rea/mechanisms/findings.md §2.1):
//   65/66        latch open/close (broadcast action code 1 / 2)
//   67/80/81/153 timed (spawn init 0x99eb0: 10 s default, 80 -> 20 s, 81 -> 30 s)
//   151/152/154  remote receivers: player touch is rejected at 0x9a060; the
//                state is driven by an equal-Tag signal (action codes 1/2/3)
//   150          cheese switch (broadcasts the machine trigger; trigger_cheese art)
//   155          boss4 two-state trigger
export const SWITCH_LATCH=[65,66];
export const SWITCH_TIMED={67:10,153:10,80:20,81:30};
export const SWITCH_REMOTE=[151,152,154];
export const SWITCH_CAT=[80,81];
// Cheese machine spawn rewrites 94/95 to type 61 and stores the charge count in
// +0x22c: 61 -> 3, 94 -> 2, 95 -> 1 (native 0xa12ec).
export const MACHINE_CHARGES={61:3,94:2,95:1};
// Native gate/bars art theme is selected from the chapter id (game+0x124 - 2,
// jump table 0x8ae1c): 2/3/5 metal, 4 bamboo, 6 spooky, 7/8 wood. Boss5/Boss7
// and the map526 special cases are handled by the caller.
// Native 0x8acb8 reads the chapter id (game+0x124): 2 metal, 3 bamboo,
// 4 metal, 5 spooky, 6/7 wood. Chapter 8's authored num is empty -> metal.
export const DOOR_CHAPTER_THEME={2:'metal',3:'bamboo',4:'metal',5:'spooky',6:'wood',7:'wood',8:'metal'};

export function mechanismKind(prop){
  if(ITEM_PROPS[prop])return 'item';
  if(prop>=210&&prop<=225)return 'gate';
  if([65,66,67,80,81,150,151,152,153,154,155].includes(prop))return 'switch';
  if([61,94,95].includes(prop))return 'machine';
  if(prop===96)return 'tv';
  if(prop===60)return 'trap';
  if(prop===28)return 'cannon';
  if(prop===265||prop===266)return 'platform';
  if(prop>=276&&prop<=278)return 'flame';
  // Boss5 gas vents (native 279-281: ObjControllerForceGenerator, non-lethal
  // knockback, sprites boss5/gas_*.png).
  if(prop>=279&&prop<=281)return 'gas';
  // 274 = one-shot spawner with flipflap art; 275 = Boss4 turret (tag 102 has a
  // shuriken_launcher variant). Both were deferred in the first import.
  if([269,270,271,272,273,274,275].includes(prop))return 'launcher';
  if(prop===353||prop===354)return 'bridge';
  if([357,358,359].includes(prop))return 'door';
  if([31,33,34,35,36,37,38,39,267,268,320].includes(prop))return 'floor';
  if([24,25,26,40,41,42,43,44,45,46,47,48].includes(prop))return 'furniture';
  return null;
}

// Native switch/door colour is tag/100: 0-99 blue, 100-199 green, 200-299 red,
// >=300 yellow (strings 0x274608/0x274610/0x291980/0x274618, PROVEN).
export function signalColour(tag){return ['blue','green','red','yellow'][Math.min(3,Math.floor(Math.abs(tag||0)/100))];}
// Native gate draw rotation is (prop-210)%4*90; collision must use the same
// orientation. Even sectors (0/180) are vertical, odd (90/270) horizontal.
export function gateVertical(prop){return ((((prop-210)%4)+4)%4)%2===0;}
export function doorTheme(level){
  const chapter=Number.parseInt(String(level?.num||''),10);
  return DOOR_CHAPTER_THEME[chapter]||'metal';
}
// Native FloorTransport factory 0x8bf84 only uses door_house.png as the
// fallback for prop 33. It first calls door_helper 0x8bd8c, which switches on
// the current map number and substitutes a map-specific sheet; 728/729 pick a
// "_1" variant when the object's floor flag is 1. Chapters 6/7 fall through
// to trapdoor_lava.png. prop 320 is mapped directly in Mechanisms.draw.
const FLOOR_DOOR_OVERRIDES={
  map711:{default:'slidingdoor_map711'},
  map727:{default:'door_house_map727'},
  map728:{default:'door_house_map728',floor1:'door_house_map728_1'},
  map729:{default:'slidingdoor_map729',floor1:'slidingdoor_map729_1'},
  map730:{default:'slidingdoor_map730'},
};
export function floorDoorSheet(level,prop){
  if(prop!==33)return null;
  const override=FLOOR_DOOR_OVERRIDES[level?.id];
  if(override)return Number(level?.floor)===1&&override.floor1?override.floor1:override.default;
  const chapter=Number.parseInt(String(level?.num||''),10);
  if(chapter===6||chapter===7)return 'trapdoor_lava';
  return null;
}
export const ITEM_LABELS={chilli:'辣椒',chilli2:'双辣椒',string:'线团',fish:'鱼骨',cover:'茶杯',balloon:'气球',dossier:'档案',robodog:'机器狗',keepsake:'纪念品',cheese_inf:'无限奶酪'};
// Colored pipe portals (native teleport controller 0xfda2c draws the
// map752_portal_glow colour): the pipe Tag selects the same 8-colour palette
// as mouse holes (props.js HOLE_COLOURS, tag%8).
export function portalColor(tag=0){return holeColour(tag);}

// Native hideable/furniture sprite mapping (ObjControllerHideable factory
// 0x8fcd8). Only 24/25/26/48 and the spooky-theme sheets actually ship in the
// 121 levels; 41-47/27/29 reference sprites that are absent from the data pack
// (recorded in findings, not reproduced here).
export const FURNITURE_SHEETS={
  24:'totem',25:'couch',26:'fridge',27:'bathtub',29:'bathtub',
  41:'metallic_shelve',42:'metallic_drawer',43:'spooky_couch',44:'coffin',
  45:'wooden_barrel',46:'wooden_chest',47:'drawers',48:'ruined_couch',
};

export const MECHANISM_SHEETS={
  cheese_speed:[44,40],speedy:[44,40],twine_ball:[64,64],catnip:[64,52],balloon:[48,64],teacup:[56,56],bucket:[68,68],
  teacup01:[68,68],teacup02:[68,68],teacup03:[68,68],teacup04:[68,68],teacup05:[68,68],teacup06:[68,68],teacup07:[68,68],teacup08:[68,68],
  dossier_icon:[64,64],robodog_broken01:[72,72],keepsake:[64,64],
  cheese_machine:[96,96],mouse_trap:[64,84],mouse_trap_cheesemask:[64,84],trigger_cheese:[40,40],trigger_bomb:[40,40],trigger_exclamation:[40,40],
  platform_rounded:[96,96],
  drawers:[64,64],
  timer:[36,36],
  flare:[128,128],
  flame_block:[90,48],flames:[130,54],flame_rotate_base:[32,32],flame_rotate:[32,32],
  gas_vent:[58,74],gas_stream:[64,44],gas_puff:[56,86],gas_vent_top:[58,74],
  bush:[72,72],ambush_01:[188,175],ambush_02:[154,142],
  wallspawner_u:[64,64],wallspawner_l:[64,64],wallspawner_d:[64,64],wallspawner_r:[64,64],
  shuriken_launcher:[72,81],
  trigger_2:[40,40],trigger_3:[40,40],trigger_4:[40,40],trigger_5:[40,40],
  trigger_set_mayan:[76,34],
  trigger_set_green_boss5:[40,40],trigger_set_red_boss5:[40,40],
  bars_boss5_red:[32,40],bars_boss5_green:[32,40],
  tv_u:[128,128],tv_l:[128,128],tv_d:[128,128],tv_r:[128,128],
  // Native ON TVs overlay two 32px spiral.png hypnotic discs on the screen
  // (MuMu 2-2 "Tune In, Drop Out" tutorial frame). Frame 0 is the off TV.
  spiral:[32,32],
  cannon01:[138,130],cannon02:[138,130],cannon03:[138,130],cannon04:[138,130],cannon05:[138,130],cannon06:[138,130],cannon07:[138,130],cannon08:[138,130],elevator:[96,76],
  // FloorTransport door sheets are 960x80 = 5 authored frames of 192x80, not
  // 80x80. Slicing at 80 px cut each door in half (and produced seven blank
  // frames), which is why 5-1's house door rendered as a thin white sliver.
  // Native 0x8bf84 passes SetScale 96 design units (1 unit = 2 web px) for
  // these sheets, which independently confirms a 192px frame.
  trapdoor_house:[192,80],trapdoor_factory:[192,80],trapdoor_spooky:[192,80],trapdoor_lava:[80,64],trapdoor_manhole:[108,108],door_house:[192,80],
  // Native door_helper 0x8bd8c overrides prop 33 art for five authored maps.
  // Scales: 711 -> 72, 727 -> 64, 728 -> 32 / _1 -> 64, 729 -> 44 / _1 -> 55,
  // 730 -> 30 design units; multiply by 2 for web pixels.
  slidingdoor_map711:[144,48],door_house_map727:[128,64],
  door_house_map728:[64,128],door_house_map728_1:[128,64],
  slidingdoor_map729:[88,109],slidingdoor_map729_1:[110,115],
  slidingdoor_map730:[60,112],
  bridge:[92,92],bridge_timed:[94,92],entrance_door:[96,192],exit_door_boss:[96,192],exit_door:[96,192],
  boss4_reflector:[128,64],boss4_breakable:[320,80],rope_post:[48,48],boss7_support:[480,320],
  boss1_oil:[180,51],emitter_boss2:[256,64],car01:[186,94],car02:[186,94],car03:[84,168],
  map760_fan:[144,198],map760_wind:[960,54],
  // Furniture sheets (factory 0x8fcd8; 896x128 = 7 frames of 128x128).
  totem:[128,128],couch:[128,128],fridge:[128,128],spooky_couch:[128,128],coffin:[128,128],ruined_couch:[128,128],
};
for(const colour of ['red','yellow','green','blue']){
  MECHANISM_SHEETS[`trigger_set_${colour}`]=[40,40];
  if(colour!=='blue')MECHANISM_SHEETS[`trigger_cat_${colour}`]=[40,40];
  for(const theme of ['wood','metal','spooky','bamboo'])MECHANISM_SHEETS[`bars_${theme}_${colour}`]=[32,40];
}
