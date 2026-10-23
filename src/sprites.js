// Sprite sheet loading + frame drawing for the imported APK art.
// Sheets are uniform grids; frame column counts are derived from image width.
import { PLAYER_SEQUENCES } from './player-animations.js';
import {CAT_REST_PROFILES,catRestFrameIndex} from './cat-rest.js';
import {MECHANISM_SHEETS} from './mechanism-types.js';
const BASE = "assets/sprites/";

// Player sheet: 16 rows = 16 facing directions, 4 columns = walk cycle.
// Row 0 faces up (-PI/2), row 4 left, row 8 down (+PI/2), row 12 right.
const PLAYER = { file: "player_run.png", fw: 74, fh: 74, rows: 16 };

const SHEETS = {
  fight: { file: 'fight.png', fw: 64, fh: 64, rows: 1 },
  cat_iris: { file: 'cat_silhoutte.png', base: 'assets/ui/', fw: 512, fh: 512, rows: 1 },
  death_bg: { file: 'bg_death.png', base: 'assets/ui/', fw: 256, fh: 256, rows: 1 },
  // Native PinholeManager transition pins (0xaf46c cases 0/2/5): the win
  // transition uses pin_hole over bg_pattern; the fail transition uses the cat
  // silhouette over bg_death.
  pin_hole: { file: 'pin_hole.png', base: 'assets/ui/', fw: 512, fh: 512, rows: 1 },
  bg_pattern: { file: 'bg_pattern.png', base: 'assets/ui/', fw: 256, fh: 256, rows: 1 },
  playerRun: PLAYER,
  cheese: { file: "cheese.png", fw: 48, fh: 48, rows: 1 },
  mousehole: { file: "home_mousehole_d.png", fw: 64, fh: 64, rows: 1 },
  hole: { file: "mouse_hole_d.png", fw: 64, fh: 64, rows: 1 },
  // Four-direction entrance/exit families are registered together below.
  // prop-260 crumbs (native all_crumbs; parallel-L1/N2): 32px cells.
  cheese_inf: { file: "cheese_inf.png", fw: 32, fh: 32, rows: 1 },
  // Native player idle / path-end / cheese FX sheets.
  // player_idle: 8x4 cells of 74px; rows up/left/down/right share idle1 timing.
  playerIdle: { file: "player_idle.png", fw: 74, fh: 74, rows: 4 },
  playerLookaround: { file: "player_lookaround.png", fw: 74, fh: 74, rows: 1 },
  target_moving: { file: "target_moving.png", fw: 64, fh: 72, rows: 1 },
  arrow: { file: "arrow.png", fw: 68, fh: 74, rows: 1 },
  shadow_generic: { file: "shadow_generic.png", fw: 43, fh: 22, rows: 1 },
  // 600x90 / (60*2) = 5 frames of 120x90 (parallel-O1).
  cheesetrail_effect: { file: "cheesetrail_effect.png", fw: 120, fh: 90, rows: 1 },
  // Prop-11 cwmouse (parallel-L2): 4x64px cells, 200 ms sequence.
  cwmouse: { file: "cwmouse01.png", fw: 64, fh: 64, rows: 1 },
  // Native cat indicator billboards (parallel-N3).
  cat_alert: { file: "cat_alert.png", fw: 32, fh: 32, rows: 1 },
  cat_peer: { file: "cat_peer.png", fw: 32, fh: 32, rows: 1 },
  cat_angry: { file: "cat_angry.png", fw: 60, fh: 32, rows: 1 },
  cat_stun: { file: "cat_stun.png", fw: 32, fh: 32, rows: 1 },
  sleep_ptcl: { file: 'sleep_ptcl.png', fw: 32, fh: 32, rows: 1 },
  ghostcat_exclamation: { file: "ghostcat_exclamation.png", fw: 14, fh: 32, rows: 1 },
  // Native pipe pieces (parallel-N2): 200-203 1 frame, 204-207 3 frames.
  pipe_d: { file: "pipe_d.png", fw: 64, fh: 64, rows: 1 },
  pipe_r: { file: "pipe_r.png", fw: 64, fh: 64, rows: 1 },
  pipe_u: { file: "pipe_u.png", fw: 64, fh: 64, rows: 1 },
  pipe_l: { file: "pipe_l.png", fw: 64, fh: 64, rows: 1 },
  pipe_flipflap_d: { file: "pipe_flipflap_d.png", fw: 64, fh: 64, rows: 1 },
  pipe_flipflap_r: { file: "pipe_flipflap_r.png", fw: 64, fh: 64, rows: 1 },
  pipe_flipflap_u: { file: "pipe_flipflap_u.png", fw: 64, fh: 64, rows: 1 },
  pipe_flipflap_l: { file: "pipe_flipflap_l.png", fw: 64, fh: 64, rows: 1 },
};

// Register the coloured type-specific strips used by Game.drawCheeses.
for (let type = 1; type <= 5; type++) {
  SHEETS[`cheese0${type}`] = { file: `cheese0${type}.png`, fw: 48, fh: 48, rows: 1 };
}
for (const dir of ["u", "l", "d", "r"]) {
  // Register complete families together: one missing direction used to make
  // every prop-22 entrance invisible, despite the PNG existing on disk.
  for(const family of ['mouse_hole','home_mousehole','key_mousehole','munch_hole']){
    SHEETS[`${family}_${dir}`]={file:`${family}_${dir}.png`,fw:64,fh:64,rows:1};
  }
}

// Five authored views cover eight headings; right views mirror the left.
// 02 and 04 are diagonals, not the cardinal left/right sheets.
const CAT_DIR = { up: "01", upLeft: "02", left: "03", downLeft: "04", down: "05" };
// Native prop -> sheet prefix (parallel-J3): 50 brown, 51 orange, 52 black,
// 53/58/59 boss, 54 blind, 55 ghost (slow/fast), 56 ninja, 57 lava, 285 jungle.
const CAT_PREFIX = [
  "browncat",
  "orangecat",
  "blackcat",
  "bosscat",
  "blindcat",
  "ghostcat_slow",
  "ghostcat_fast",
  "ninjacat",
  "lavacat",
  "junglecat",
];
for (const prefix of CAT_PREFIX) {
  for (const [dir, num] of Object.entries(CAT_DIR)) {
    SHEETS[`${prefix}_${dir}`] = { file: `${prefix}${num}.png`, fw: 64, fh: 64, rows: 1 };
  }
}
for(const {prefix,cell=64} of Object.values(CAT_REST_PROFILES))SHEETS[`${prefix}_common`]={file:`${prefix}_common.png`,fw:cell,fh:cell,rows:1};
for(const [key,[fw,fh]] of Object.entries(MECHANISM_SHEETS))SHEETS[key]={file:`${key}.png`,fw,fh,rows:1};

export class Sprites {
  constructor() {
    this.images = {};
    this.enabled = true;
  }

  load() {
    for (const [name, sequence] of Object.entries(PLAYER_SEQUENCES)) {
      SHEETS[`sequence_${name}`] = { file: sequence.file, fw: sequence.fw, fh: sequence.fh };
    }
    if (typeof location !== "undefined" && location.search) {
      const urls = new URLSearchParams(location.search);
      if (urls.get("shapes") === "1") this.enabled = false;
    }
    for (const [key, def] of Object.entries(SHEETS)) {
      const img = new Image();
      img.onload = () => {
        def.cols = Math.max(1, Math.round(img.naturalWidth / def.fw));
        def.image = img;
      };
      img.src = (def.base || BASE) + def.file;
      this.images[key] = def;
    }
  }

  ready(key) {
    const s = this.images[key];
    return !!(this.enabled && s && s.image && s.cols);
  }

  frame(ctx, key, frame, x, y, w, h) {
    const s = this.images[key];
    if (!this.ready(key)) return false;
    const col = ((frame % s.cols) + s.cols) % s.cols;
    ctx.drawImage(s.image, col * s.fw, 0, s.fw, s.fh, x - w / 2, y - h / 2, w, h);
    return true;
  }

  tintedFrame(ctx,key,frame,x,y,w,h,colour){
    if(!this.ready(key))return false;
    this.tintCache??=new Map();const cacheKey=`${key}:${colour}`;
    let sheet=this.tintCache.get(cacheKey);const s=this.images[key];
    if(!sheet){
      sheet=document.createElement('canvas');sheet.width=s.image.naturalWidth;sheet.height=s.image.naturalHeight;
      const tint=sheet.getContext('2d');tint.drawImage(s.image,0,0);
      tint.globalCompositeOperation='multiply';tint.fillStyle=colour;tint.fillRect(0,0,sheet.width,sheet.height);
      tint.globalCompositeOperation='destination-in';tint.drawImage(s.image,0,0);
      this.tintCache.set(cacheKey,sheet);
    }
    const col=((frame%s.cols)+s.cols)%s.cols;
    ctx.drawImage(sheet,col*s.fw,0,s.fw,s.fh,x-w/2,y-h/2,w,h);return true;
  }

  drawDeathBackground(ctx, width, height) {
    if (!this.ready('death_bg')) {
      ctx.fillStyle = '#7433aa'; ctx.fillRect(0, 0, width, height); return;
    }
    const tile = 256 * Math.max(width / 960, height / 640);
    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) ctx.drawImage(this.images.death_bg.image, x, y, tile, tile);
    }
  }

  // PinholeManager case 0/5 background (0xaf46c): the win transition reveals
  // this pattern outside the shrinking pin_hole circle.
  drawPatternBackground(ctx, width, height) {
    if (!this.ready('bg_pattern')) {
      ctx.fillStyle = '#1d6f92'; ctx.fillRect(0, 0, width, height); return;
    }
    const tile = 256 * Math.max(width / 960, height / 640);
    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) ctx.drawImage(this.images.bg_pattern.image, x, y, tile, tile);
    }
  }

  catIris(ctx, x, y, size, width, height) {
    if (!this.ready('cat_iris')) return false;
    if (!this.irisCanvas) {
      this.irisCanvas = document.createElement('canvas');
      this.irisCanvas.width = this.irisCanvas.height = 512;
      const tint = this.irisCanvas.getContext('2d');
      tint.drawImage(this.images.cat_iris.image, 0, 0);
      // Invert the source alpha: the transparent cat opening becomes the
      // shape used to cut a hole in the stationary death-background layer.
      tint.globalCompositeOperation = 'source-out';
      tint.fillStyle = '#000'; tint.fillRect(0, 0, 512, 512);
    }
    if (!this.deathCanvas) this.deathCanvas = document.createElement('canvas');
    if (this.deathCanvas.width !== Math.ceil(width)) this.deathCanvas.width = Math.ceil(width);
    if (this.deathCanvas.height !== Math.ceil(height)) this.deathCanvas.height = Math.ceil(height);
    const layer = this.deathCanvas.getContext('2d');
    layer.globalCompositeOperation = 'source-over';
    layer.clearRect(0, 0, width, height);
    this.drawDeathBackground(layer, width, height);
    layer.globalCompositeOperation = 'destination-out';
    layer.drawImage(this.irisCanvas, x-size/2, y-size/2, size, size);
    layer.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.deathCanvas, 0, 0);
    return true;
  }

  // Player: pick facing row from angle and walk-cycle column.
  cheeseReflection(ctx, key, frame, x, y, size, sweepX) {
    if (!this.ready(key) || Math.abs(sweepX - x) > size) return false;
    const s = this.images[key];
    if (!this.reflectionCanvas) {
      this.reflectionCanvas = document.createElement('canvas');
      this.reflectionCanvas.width = 48;
      this.reflectionCanvas.height = 48;
    }
    const mask = this.reflectionCanvas.getContext('2d');
    mask.clearRect(0, 0, 48, 48);
    mask.globalCompositeOperation = 'source-over';
    mask.drawImage(s.image, (frame % s.cols) * s.fw, 0, s.fw, s.fh, 0, 0, 48, 48);
    const offset = 24 + (sweepX - x) * 48 / size;
    const gradient = mask.createLinearGradient(offset - 8, 32, offset + 8, 16);
    gradient.addColorStop(0, 'rgba(255,255,235,0)');
    gradient.addColorStop(0.5, 'rgba(255,255,235,0.65)');
    gradient.addColorStop(1, 'rgba(255,255,235,0)');
    mask.globalCompositeOperation = 'source-in';
    mask.fillStyle = gradient;
    mask.fillRect(0, 0, 48, 48);
    ctx.drawImage(this.reflectionCanvas, x - size / 2, y - size / 2, size, size);
    return true;
  }

  playerSequenceFrame(ctx, name, elapsedMs, x, y, w = 74, h = 74, angle = 0) {
    const sequence = PLAYER_SEQUENCES[name];
    const key = `sequence_${name}`;
    if (!sequence || !this.ready(key)) return false;
    let time = Math.max(0, elapsedMs) % sequence.duration;
    let frame = sequence.frames.at(-1);
    for (const candidate of sequence.frames) {
      if (time < candidate.ms) { frame = candidate; break; }
      time -= candidate.ms;
    }
    const s = this.images[key];
    const row = name === 'idle1' ? playerIdleRow(angle) : frame.cy;
    ctx.drawImage(s.image, frame.cx * s.fw, row * s.fh, s.fw, s.fh,
      // Native 0x133078..0x133084 adds oy in the game's Y-up space.
      // Canvas uses Y-down, so positive authored oy raises the frame.
      x - w / 2 + frame.ox * w / s.fw, y - h / 2 - frame.oy * h / s.fh, w, h);
    return true;
  }

  playerFrame(ctx, animT, x, y, w, h, angle) {
    const s = this.images.playerRun;
    if (!this.ready("playerRun")) return false;
    let row = Math.round(8 + (Math.PI / 2 - angle) / (Math.PI / 8));
    row = ((row % 16) + 16) % 16;
    // Native run sequence: 4 frames at 75 ms (parallel-O1).
    const col = Math.floor(animT / 0.075) % s.cols;
    ctx.drawImage(s.image, col * s.fw, row * s.fh, s.fw, s.fh, x - w / 2, y - h / 2, w, h);
    return true;
  }

  // Idle: native anim_sequences/idle.xml 'idle1' on player_idle.png:
  // columns 0,2,0,3,4,6,4,6,4,5,4,7,0,2,1,2,0,3,4,7 with per-frame delays
  // 500,100,1000,100,1000,100,200,100,1000,300,1000,100,1000,100,1500,100,
  // 1000,100,1000,100 ms (10.4 s total, parallel-O1). player_lookaround is
  // NOT referenced by the shipped .so, so it is not used here.
  playerIdleFrame(ctx, elapsedMs, x, y, w, h, angle = 0) {
    const s = this.images.playerIdle;
    if (!this.ready("playerIdle")) return false;
    const cols = [0, 2, 0, 3, 4, 6, 4, 6, 4, 5, 4, 7, 0, 2, 1, 2, 0, 3, 4, 7];
    const delays = [500, 100, 1000, 100, 1000, 100, 200, 100, 1000, 300, 1000, 100, 1000, 100, 1500, 100, 1000, 100, 1000, 100];
    let total = 0;
    for (const d of delays) total += d;
    let t = elapsedMs % total;
    let i = 0;
    while (i < delays.length - 1 && t >= delays[i]) {
      t -= delays[i];
      i++;
    }
    const col = cols[i] % s.cols;
    const row = playerIdleRow(angle);
    ctx.drawImage(s.image, col * s.fw, row * s.fh, s.fw, s.fh, x - w / 2, y - h / 2 - 12 * h / s.fh, w, h);
    return true;
  }

  catRestFrame(ctx,cat,x,y,w,h){
    const profile=CAT_REST_PROFILES[cat.type],rest=cat.rest;
    if(!profile||!rest)return false;
    const key=`${profile.prefix}_common`,sheet=this.images[key];
    if(!this.ready(key))return false;
    const col=catRestFrameIndex(profile,rest.phase,rest.frameTime);
    const fw=sheet.fw,fh=sheet.fh,width=w*fw/64,height=h*fh/64;
    // The common strip is one authored side view, unlike the five walk views.
    if(Math.cos(cat.angle)>0){
      ctx.save();ctx.translate(x,y);ctx.scale(-1,1);
      ctx.drawImage(sheet.image,col*fw,0,fw,fh,-width/2,-height/2,width,height);ctx.restore();
    }else ctx.drawImage(sheet.image,col*fw,0,fw,fh,x-width/2,y-height/2,width,height);
    if(rest.phase==='sleep'&&rest.frameTime>=.8){
      const side=Math.cos(cat.angle)>0?1:-1;
      this.frame(ctx,'sleep_ptcl',Math.floor(rest.frameTime/.2),x+side*w*.27,y-h*.6,w*.5,h*.5);
    }
    return true;
  }

  // Cat sheets are multi-animation strips (parallel-J3): columns 0-3 walk,
  // 5-8 alert/chase, 9+ specials. Selecting the state's range stops the
  // constant animation switching. Sheets with fewer columns clamp to walk.
  catHypnotizedFrame(ctx,prefix,cat,x,y,w,h,elapsedSeconds){
    // Native ObjControllerCat loads `idle_tv_0..3` from <prefix>_common
    // (`cat_hypnotized_speed`). Those are the four sitting-watching-TV frames
    // after the sleep/wake strip (black/boss/ninja/lava commons have 23/24
    // columns; brown common only has 14 and falls back).
    const key=`${prefix}_common`,sheet=this.images[key];
    if(!this.ready(key))return false;
    const cols=sheet.cols||Math.floor(sheet.image.width/sheet.fw);
    if(cols<18)return false;
    const frame=14+Math.floor(elapsedSeconds/0.22)%4;
    const fw=sheet.fw,fh=sheet.fh,width=w*fw/64,height=h*fh/64;
    if(Math.cos(cat.angle)>0){
      ctx.save();ctx.translate(x,y);ctx.scale(-1,1);
      ctx.drawImage(sheet.image,frame*fw,0,fw,fh,-width/2,-height/2,width,height);ctx.restore();
    }else ctx.drawImage(sheet.image,frame*fw,0,fw,fh,x-width/2,y-height/2,width,height);
    return true;
  }

  catFrame(ctx, prefix, state, elapsedSeconds, x, y, w, h, angle) {
    const facing = catFacing(angle);
    const key = `${prefix}_${facing.dir}`;
    const s = this.images[key];
    if (!this.ready(key)) return false;
    const cols = s.cols || 1;
    let start = 0;
    let count = 4;
    if (state === "spot" || state === "chase") {
      start = 5;
      count = 4;
    } else if(state==='distracted'||state==='hypnotized'){
      start=4;count=1;
    } else if (state === "stunned") {
      start = 9;
      count = 4;
    }
    if (start >= cols) {
      start = 0;
      count = Math.min(4, cols);
    }
    const span = Math.max(1, Math.min(count, cols - start));
    // SetSequence(..., delay=0xc8): one frame per 200 ms, for both walk
    // and alert/chase. elapsedSeconds must be a real clock, not an FPS count.
    const col = start + (Math.floor((elapsedSeconds + 1e-9) / 0.2) % span);
    if (facing.flip) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-1, 1);
      ctx.drawImage(s.image, col * s.fw, 0, s.fw, s.fh, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(s.image, col * s.fw, 0, s.fw, s.fh, x - w / 2, y - h / 2, w, h);
    }
    return true;
  }
}

export function playerIdleRow(angle) {
  // Authored rows: up, left, down, right. Keep the final movement heading
  // when the path finishes; diagonal headings choose the nearest cardinal.
  return ((Math.round((Math.PI * 1.5 - angle) / (Math.PI / 2)) % 4) + 4) % 4;
}

export function catFacing(angle) {
  const octant = ((Math.round((angle + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
  const dirs = ["up", "upLeft", "left", "downLeft", "down", "downLeft", "left", "upLeft"];
  return { dir: dirs[octant], flip: octant > 0 && octant < 4 };
}

// Native prop/type -> sheet prefix (parallel-J3, factory 0x884b4).
export function catPrefixFor(cat, state) {
  const type = cat && cat.type != null ? cat.type : 0;
  if (type === 1) return "orangecat";
  if (type === 2) return "blackcat";
  if (type === 3 || type === 8 || type === 9) return "bosscat";
  if (type === 4) return "blindcat";
  if (type === 5) return state === "chase" || state === "spot" ? "ghostcat_fast" : "ghostcat_slow";
  if (type === 6) return "ninjacat";
  if (type === 7) return "lavacat";
  if (type === 10) return "junglecat";
  return "browncat";
}
