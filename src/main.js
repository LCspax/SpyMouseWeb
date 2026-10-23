import { Game } from "./game.js";
import { loadContent } from "./content.js";
import { resultsModel, renderResults, RESULTS_COUNT_TIME } from './results.js';
import { FrontEnd } from './menu.js';
import { audio } from './audio.js';
import { showTipPopup } from './popups.js';

const canvas = document.getElementById("game");
const overlay = document.getElementById("overlay");
const ovTitle = document.getElementById("ovTitle");
const ovText = document.getElementById("ovText");
const ovLevels = document.getElementById("ovLevels");
const ovPrimary = document.getElementById("ovPrimary");
const ovSecondary = document.getElementById("ovSecondary");
const ovTertiary = document.getElementById('ovTertiary');
const hudLives = document.getElementById("hudLives");
const hudCheese = document.getElementById("hudCheese");
const hudTime = document.getElementById("hudTime");
const hudScore = document.getElementById("hudScore");
const btnPause = document.getElementById("btnPause");
const hud = document.getElementById('hud');
const resultsDetails = document.getElementById('resultsDetails');

const game = new Game(canvas);
window.__game = game;

// Dossiers are permanent collectibles (native collected_all_dossiers): the
// pickup handler reports the native dossier id (0..16) and the backpack UI
// reads progress.dossiers.
game.onDossier = (tag) => {
  if (!progress.dossiers.includes(tag)) {
    progress.dossiers.push(tag);
    saveProgress();
  }
};
game.onSecretFound = (levelId) => {
  if (!progress.secrets.includes(levelId)) {
    progress.secrets.push(levelId);
    saveProgress();
  }
};

const SAVE_KEY = "spymouse.progress.v1";
const progress = loadProgress();
let LEVELS = [];
let SOURCE = "builtin";
let frontEnd = null;
let tipShown = false;

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { done: [], last: 0, dossiers: [], secrets: [] };
    const p = JSON.parse(raw);
    return {
      done: Array.isArray(p.done) ? p.done : [],
      last: p.last || 0,
      dossiers: Array.isArray(p.dossiers) ? p.dossiers.filter((n) => Number.isInteger(n) && n >= 0) : [],
      secrets: Array.isArray(p.secrets) ? p.secrets.filter((id) => typeof id === 'string') : [],
    };
  } catch {
    return { done: [], last: 0, dossiers: [], secrets: [] };
  }
}
function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
  } catch {}
}

function levelLabel(def, i) {
  if (def && def.num) return def.num;
  return String(i + 1);
}

function formatTime(t) {
  if (t == null) return "";
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function buildLevelGrid() {
  ovLevels.innerHTML = "";
  LEVELS.forEach((def, i) => {
    const b = document.createElement("button");
    b.textContent = levelLabel(def, i);
    b.title = (def && def.name) || "";
    if (progress.done.includes(i)) b.classList.add("done");
    if (i === (game.state === 'menu' ? progress.last : game.levelIndex)) b.classList.add("playing");
    b.addEventListener("click", () => {
      hideOverlay();
      startLevel(i);
    });
    ovLevels.appendChild(b);
  });
}

function showOverlay(mode) {
  if(frontEnd && (mode==='menu'||mode==='home')) {
    hideOverlay();game.state='menu';
    if(mode==='home')frontEnd.showHome();else frontEnd.showWorld();
    return;
  }
  overlay.inert = false;
  ovPrimary.disabled = false;
  overlay.classList.remove('pause-panel');
  overlay.classList.remove('results-panel');
  overlay.classList.remove('completion-banner');
  overlay.classList.remove('caught-panel');
  for (const btn of [ovPrimary, ovSecondary, ovTertiary]) {
    if (!btn || !btn.classList) continue;
    btn.classList.remove('pause-continue', 'pause-retry', 'pause-home');
  }
  if (mode !== 'paused') audio.stopSound(145);
  if(resultsDetails) resultsDetails.style.display='none';
  ovPrimary.style.display='';
  ovPrimary.title='';
  if (mode === 'paused') overlay.classList.add('pause-panel');
  overlay.classList.remove("hidden");
  ovLevels.style.display = "none";
  ovSecondary.style.display = "none";
  if(ovTertiary)ovTertiary.style.display='none';

  if (mode === "menu" || mode === "loading") {
    if (!frontEnd) audio.playMusic("CM_Menu1", { loop: true, fade: 0.35 });
    ovTitle.textContent = "SPY MOUSE";
    ovText.textContent =
      mode === "loading"
        ? "Loading levels..."
        : "Draw a path for Agent Squeek. Collect every wedge of cheese, then reach the mouse hole. Stay out of the cats' sight.";
    ovLevels.style.display = "grid";
    buildLevelGrid();
    ovPrimary.textContent = "Play";
    ovPrimary.disabled = mode === "loading";
    ovPrimary.onclick = () => {
      hideOverlay();
      startLevel(progress.last);
    };
    ovSecondary.style.display = "";
    ovSecondary.textContent = "Reset Progress";
    ovSecondary.onclick = () => {
      progress.done = [];
      progress.last = 0;
      saveProgress();
      buildLevelGrid();
    };
  } else if (mode === "paused") {
    const english=frontEnd?.settings.language==='en';
    ovTitle.textContent = english?'PAUSED':'暂停';
    ovText.textContent = resultsModel(game.level).title;
    ovPrimary.textContent = english?'Resume':'继续';
    ovPrimary.classList.add('pause-continue');
    ovPrimary.onclick = () => {
      hideOverlay();
      game.resume();
    };
    ovSecondary.style.display = "";
    ovSecondary.textContent = english?'Restart':'重玩本关';
    ovSecondary.classList.add('pause-retry');
    ovSecondary.onclick = () => {
      hideOverlay();
      game.restart();
    };
    if(ovTertiary) {
      ovTertiary.style.display='';ovTertiary.textContent=english?'Level Select':'返回选关';
      ovTertiary.classList.add('pause-home');
      ovTertiary.onclick=()=>showOverlay('menu');
    }
    audio.playSound(1, { priority: 6 });
  } else if (mode === "caught") {
    // Round 2: the death presentation (fight -> closing -> fail) is drawn on the
    // canvas; this overlay is a translucent purple panel so the native
    // bg_death + cat silhouette stay visible behind it.
    const english = frontEnd?.settings.language === 'en';
    overlay.classList.add('caught-panel');
    ovTitle.textContent = english ? 'CAUGHT!' : '被抓住了！';
    ovText.textContent = english ? 'The cat got you. Try again?' : '猫抓到了你，再试一次？';
    ovPrimary.textContent = english ? 'Retry' : '再试一次';
    ovPrimary.setAttribute('aria-label', ovPrimary.textContent);
    ovPrimary.onclick = () => {
      hideOverlay();
      overlay.classList.remove('caught-panel');
      if (typeof game.retryLevel === 'function') game.retryLevel();
      else if (typeof game.resumeAfterCaught === 'function') game.resumeAfterCaught();
      else startLevel(game.levelIndex);
    };
    ovSecondary.style.display = '';
    ovSecondary.textContent = english ? 'Level Select' : '返回选关';
    ovSecondary.setAttribute('aria-label', ovSecondary.textContent);
    ovSecondary.onclick = () => showOverlay('menu');
    if (ovTertiary) ovTertiary.style.display = 'none';
    ovLevels.style.display = 'none';
  } else if (mode === "timeout") {
    ovTitle.textContent = "TIME UP!";
    ovText.textContent = "The level timer ran out. Try again?";
    ovPrimary.textContent = "Retry Level";
    ovPrimary.onclick = () => {
      hideOverlay();
      startLevel(game.levelIndex);
    };
    ovLevels.style.display = "grid";
    buildLevelGrid();
    ovSecondary.style.display = "";
    ovSecondary.textContent = "Menu";
    ovSecondary.onclick = () => showOverlay("menu");
  } else if (mode === "gameover") {
    ovTitle.textContent = "GAME OVER";
    ovText.textContent = "You ran out of lives. Try again?";
    ovPrimary.textContent = "Retry Level";
    ovPrimary.onclick = () => {
      hideOverlay();
      startLevel(game.levelIndex);
    };
    ovLevels.style.display = "grid";
    buildLevelGrid();
    ovSecondary.style.display = "";
    ovSecondary.textContent = "Menu";
    ovSecondary.onclick = () => showOverlay("menu");
  } else if (mode === 'complete') {
    overlay.classList.add('completion-banner');
    ovTitle.textContent=frontEnd?.settings.language==='en'?'Level Complete':'完成关卡';ovText.textContent='';ovPrimary.style.display='none';
  } else if (mode === "clear") {
    overlay.classList.add('results-panel');
    // The scrolling background mask grows from the exit door, not from a
    // generic screen edge (CSS vars are consumed by results-circle-in).
    if (game.level?.exit && typeof game.worldToScreen === 'function') {
      const p = game.worldToScreen(game.level.exit.x, game.level.exit.y);
      overlay.style?.setProperty?.('--results-origin-x', `${(p.x / Math.max(1, game.cssW)) * 100}%`);
      overlay.style?.setProperty?.('--results-origin-y', `${(p.y / Math.max(1, game.cssH)) * 100}%`);
    }
    const english=frontEnd?.settings.language==='en';
    const model=resultsModel(game.level,game.lastSettlement,english?'en':'zh');
    ovTitle.textContent=game.bossWorldComplete?(english?'World Complete!':'世界通关'):(english?'Results!':'结果');ovText.textContent=`${model.number}\n${model.title}`;
    audio.playSound(144, { priority: 7 });
    // Native tip.gui ("CONGRATULATIONS" + popup_first_item) is the reward
    // popup.  Show it once per session when a level clears all three goals.
    // Browser only: `frontEnd` is null in the Node smoke harness.
    if (frontEnd && !tipShown && model.goals.length >= 3 && model.goals.every((goal) => goal.earned)) {
      tipShown = true;
      const tipText = english
        ? { title: 'CONGRATULATIONS', body: 'All three goals completed!' }
        : { title: '恭喜', body: '三个目标全部达成！' };
      setTimeout(() => {
        try {
          showTipPopup({ host: document.getElementById('frontEnd'), ...tipText });
        } catch { /* popups are decorative: never break the results screen */ }
      }, 1400);
    }
    if(resultsDetails) {resultsDetails.style.display='';renderResults(resultsDetails,model,{countDuration:RESULTS_COUNT_TIME});}
    ovPrimary.textContent=english?'Next':'下一关';ovPrimary.title=english?'Next: Level Select':'下一关：进入选关';
    ovPrimary.onclick=()=>{game.state='menu';showOverlay('menu');if(!frontEnd)ovTitle.textContent='选择关卡';};
    ovSecondary.style.display='';ovSecondary.textContent=english?'Retry':'重玩本关';
    ovSecondary.onclick=()=>{hideOverlay();game.restart();};
  }
}

function hideOverlay() {
  overlay.inert = true;
  overlay.classList.add("hidden");
}

function startLevel(i) {
  if (!LEVELS.length) return;
  i = Math.max(0, Math.min(LEVELS.length - 1, i));
  audio.stopMusic(0.25);
  game.abandonBonus?.();
  game.loadLevel(LEVELS[i], i);
  progress.last = i;
  saveProgress();
}

function bumpHud(el) {
  if (!el || !el.classList) return;
  // The CSS FX (glow / score-bonus / star particle) live on the .hud-slot, the
  // number bump lives on the value element itself.
  const nodes = [el, el.parentElement];
  for (const node of nodes) {
    if (!node || !node.classList) continue;
    node.classList.remove('hud-bump');
    // Restart the CSS animation on repeated changes (browser only; guarded).
    if (typeof node.offsetWidth === 'number') void node.offsetWidth;
    node.classList.add('hud-bump');
    clearTimeout(node.__hudBumpTimer);
    node.__hudBumpTimer = setTimeout(() => node.classList.remove('hud-bump'), 320);
  }
}

  game.onHud = ({ lives, cheeseLeft, timeLeft, score }) => {
    // Native has no lives counter; the HUD shows cheese and score instead.
    hudLives.textContent = "";
    const cheeseText = `${cheeseLeft}`;
    if (hudCheese.textContent !== cheeseText) {
      hudCheese.textContent = cheeseText;
      bumpHud(hudCheese);
    }
    if (hudScore) {
      const scoreText = `${score || 0}`;
      if (hudScore.textContent !== scoreText) {
        hudScore.textContent = scoreText;
        bumpHud(hudScore);
      }
    }
    // No level timer.
    if (hudTime) hudTime.textContent = "";
};

game.onLevelEnd = ({ type, level }) => {
  activePointer = null;
  game.cancelStroke();
  if (type === "clear") {
    if (!progress.done.includes(level)) progress.done.push(level);
    progress.last = Math.min(level + 1, LEVELS.length - 1);
    saveProgress();
    // The hero has finished shrinking into the exit. Start the results
    // scrolling-background mask around the exit; the panel itself is delayed
    // in CSS until the mask has covered the screen.
    showOverlay('clear');
  } else if (type === 'results') {
    // Panel is already revealed by the clear overlay's delayed CSS animation.
    // Keep the event for the native phase order / tests.
  } else if (type === "caught") {
    // Fired once when the death presentation reaches `fail` (lead's game.js):
    // the canvas keeps the purple bg_death + cat silhouette, the panel lets the
    // player retry manually.
    showOverlay("caught");
  } else if (type === "timeout") {
    setTimeout(() => {
      if (game.state === "timeout") showOverlay("timeout");
    }, 350);
  } else if (type === "gameover") {
    setTimeout(() => showOverlay("gameover"), 350);
  }
};

let activePointer = null;

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function endActivePointer(commit) {
  if (activePointer === null) return;
  const id = activePointer;
  activePointer = null;
  try { canvas.releasePointerCapture(id); } catch {}
  if (commit) game.onPointerUp();
  else game.cancelStroke();
}

canvas.addEventListener("pointerdown", (e) => {
  if (game.state !== "playing") return;
  audio.unlock(); // real user gesture: mobile browsers require this before playback
  if (activePointer !== null) endActivePointer(false);
  activePointer = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  game.onPointerDown(canvasPoint(e));
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== activePointer) return;
  game.onPointerMove(canvasPoint(e));
});
// Release on the window so a lost pointer capture or a drag off-canvas can
// never leave the input stuck.
window.addEventListener("pointerup", (e) => {
  if (e.pointerId === activePointer) endActivePointer(true);
});
window.addEventListener("pointercancel", (e) => {
  if (e.pointerId === activePointer) endActivePointer(false);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

btnPause.addEventListener("click", () => {
  if (game.state === "playing") {
    activePointer = null;
    game.cancelStroke();
    game.pause();
    showOverlay("paused");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.state === "playing") {
    activePointer = null;
    game.cancelStroke();
    game.pause();
    showOverlay("paused");
  }
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  if (hud) hud.style.visibility = game.state === 'caught' || game.state === 'levelclear' || game.state === 'menu' ? 'hidden' : '';
  game.draw();
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => game.resize());
window.addEventListener("orientationchange", () => game.resize());

async function boot() {
  showOverlay("loading");
  const content = await loadContent();
  LEVELS = content.levels;
  SOURCE = content.source;
  window.__levels = LEVELS;
  game.levelCatalog = LEVELS;
  for (const tag of progress.dossiers) game.dossiers.add(tag);
  for (const id of progress.secrets) game.secretsFound.add(id);
  const menuRoot=document.getElementById('frontEnd');
  if(menuRoot && typeof menuRoot.querySelector==='function') {
    try {
      const response=await fetch('assets/menu/worlds.json');
      if(!response.ok)throw new Error('world menu data unavailable');
      const worlds=await response.json();
      frontEnd=new FrontEnd(menuRoot,LEVELS,worlds,{
        getProgress:()=>progress,
        onPlay:index=>{hideOverlay();startLevel(index);},
        onErase:()=>{progress.done=[];progress.last=0;progress.dossiers=[];progress.secrets=[];game.dossiers.clear();game.secretsFound.clear();saveProgress();},
      });
    } catch(error) {console.warn('original menu could not load',error);}
  }
  if (SOURCE === "builtin") {
    console.warn("Imported content not found - using built-in sample levels.");
  }
  game.loadLevel(LEVELS[Math.min(progress.last, LEVELS.length - 1)], Math.min(progress.last, LEVELS.length - 1));
  game.state = "menu";
  game.emitHud();
  hudLives.textContent = "";
  hudCheese.textContent = "0";
  if (hudScore) hudScore.textContent = "";
  showOverlay(frontEnd?'home':'menu');
  requestAnimationFrame(frame);
}

boot();

