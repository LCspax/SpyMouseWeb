import { Game } from "./game.js";
import { loadContent } from "./content.js";
import { resultsModel, renderResults, RESULTS_COUNT_TIME } from './results.js';
import { FrontEnd } from './menu.js';
import { audio } from './audio.js';
import { showTipPopup } from './popups.js';
import { normaliseBossRun } from './boss-flow.js';
import { arenaLink } from './boss-links.js';
import { LoadingScreen, MENU_ART, loadImages, warmLevelArt } from './loader.js';

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

// iOS Safari only unlocks Web Audio inside a real user gesture. Capture every
// tap/click, including overlay buttons outside the menu and canvas, so the
// first interaction is enough to start menu/game audio.
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true, passive: true });
window.addEventListener('keydown', () => audio.unlock(), { capture: true });

// Yellow loading transition (see src/loader.js). It is a plain DOM layer, so it
// keeps working while the canvas is frozen behind it.
const loader = new LoadingScreen(document.getElementById('loader'));
let levelLoading = false;

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
// Boss run snapshots are written by src/boss-flow.js through Game.saveBossRun.
// Every checkpoint (sector change, hit, intro end, death) lands here, so a
// reload or a trip to the level select resumes the same fight.
game.onBossRun = (run) => {
  progress.bossRun = run ? normaliseBossRun(run) : null;
  saveProgress();
};
// Reward-room payout: recorded once per parent level, keyed by level id.
game.onBonusReward = ({ levelId, targetId, multiplier }) => {
  progress.bonus[levelId] = { targetId, multiplier, at: Date.now() };
  progress.secrets = progress.secrets.includes(targetId) ? progress.secrets : [...progress.secrets, targetId];
  game.bonusClaims[levelId] = true;
  saveProgress();
};
// A wall crack is spent per ENTRANCE: only the one that was pushed through and
// cleared closes, so another door into the same hidden level stays open.
game.onCrackUsed = (crackId) => {
  if (!crackId) return;
  progress.cracks[crackId] = true;
  saveProgress();
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
    if (!raw) return { done: [], last: 0, dossiers: [], secrets: [], boss: {}, bonus: {}, cracks: {}, bossRun: null };
    const p = JSON.parse(raw);
    return {
      done: Array.isArray(p.done) ? p.done : [],
      last: p.last || 0,
      dossiers: Array.isArray(p.dossiers) ? p.dossiers.filter((n) => Number.isInteger(n) && n >= 0) : [],
      secrets: Array.isArray(p.secrets) ? p.secrets.filter((id) => typeof id === 'string') : [],
      // Boss chapter records (cleared/rewarded) and the resumable run.
      boss: p.boss && typeof p.boss === 'object' ? p.boss : {},
      bonus: p.bonus && typeof p.bonus === 'object' ? p.bonus : {},
      // Wall-crack entrances already pushed through and cleared (src/secrets.js).
      cracks: p.cracks && typeof p.cracks === 'object' ? p.cracks : {},
      bossRun: normaliseBossRun(p.bossRun),
    };
  } catch {
    return { done: [], last: 0, dossiers: [], secrets: [], boss: {}, bonus: {}, cracks: {}, bossRun: null };
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
    const bossFight = game.bossFlow?.kind === 'arena';
    const rewardRoom = !!game.bonusReturn;
    // Boss entrance: the losing condition is the forced advance catching up,
    // not a cat - say so, or the player has no idea what killed them.
    const scrollRun = !!game.death?.cause && game.death.cause === 'scroll';
    ovTitle.textContent = rewardRoom
      ? (english ? 'BONUS FAILED' : '奖励关失败')
      : bossFight ? (english ? 'BOSS WINS' : 'Boss 击败了你')
        : scrollRun ? (english ? 'LEFT BEHIND' : '被推进甩下了！')
          : (english ? 'CAUGHT!' : '被抓住了！');
    ovText.textContent = rewardRoom
      ? (english ? 'The reward room is still open. Back to the level?' : '奖励关可以再来，也可以先回本关。')
      : bossFight
        ? (english ? 'The boss got you. Try the fight again?' : '被 Boss 击中，要再来一次吗？')
        : scrollRun
          ? (english ? 'The advance caught up. Keep moving to stay ahead!' : '推进追上了你，别停下，跟着卷轴往前跑！')
          : (english ? 'The cat got you. Try again?' : '猫抓到了你，再试一次？');
    ovPrimary.textContent = rewardRoom
      ? (english ? 'Back to Level' : '返回本关')
      : (english ? 'Retry' : '再试一次');
    ovPrimary.setAttribute('aria-label', ovPrimary.textContent);
    ovPrimary.onclick = () => {
      hideOverlay();
      overlay.classList.remove('caught-panel');
      // A failed reward room restores the parent exactly where it was left and
      // keeps the entrance claimable (no lost or duplicated reward).
      if (rewardRoom) {
        game.finishBonus(false);
        return;
      }
      if (typeof game.retryLevel === 'function') game.retryLevel();
      else if (typeof game.resumeAfterCaught === 'function') game.resumeAfterCaught();
      else startLevel(game.levelIndex);
    };
    ovSecondary.style.display = '';
    ovSecondary.textContent = rewardRoom
      ? (english ? 'Try Room Again' : '再进奖励关')
      : (english ? 'Level Select' : '返回选关');
    ovSecondary.setAttribute('aria-label', ovSecondary.textContent);
    ovSecondary.onclick = () => {
      if (rewardRoom) {
        hideOverlay();
        overlay.classList.remove('caught-panel');
        game.retryLevel();
        return;
      }
      showOverlay('menu');
    };
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
    const bossRun = game.lastBossDefeat || null;
    const bossLink = bossRun ? arenaLink(game.level?.id) : null;
    if (bossLink) {
      // Boss settlement: the chapter name + world-complete banner replace the
      // generic "Results!" heading; the score panel stays untouched.
      ovTitle.textContent = game.bossWorldComplete
        ? (english ? 'World Complete!' : '世界通关')
        : (english ? 'Boss Defeated!' : 'Boss 击败');
      ovText.textContent = `${model.number}\n${bossLink.num}${english ? '' : ' · '}${model.title}`;
    } else {
      ovTitle.textContent=game.bossWorldComplete?(english?'World Complete!':'世界通关'):(english?'Results!':'结果');ovText.textContent=`${model.number}\n${model.title}`;
    }
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
    ovPrimary.textContent=bossLink
      ? (english?'Back to Map':'返回地图')
      : (english?'Next':'下一关');
    ovPrimary.title=english?'Next: Level Select':'下一关：进入选关';
    ovPrimary.onclick=()=>{game.state='menu';showOverlay('menu');if(!frontEnd)ovTitle.textContent='选择关卡';};
    ovSecondary.style.display='';ovSecondary.textContent=bossLink
      ? (english?'Challenge Again':'再次挑战')
      : (english?'Retry':'重玩本关');
    ovSecondary.onclick=()=>{hideOverlay();game.restart();};
  }
}

function hideOverlay() {
  overlay.inert = true;
  overlay.classList.add("hidden");
}

function startLevel(i) {
  if (!LEVELS.length) return;
  // A load is already on screen: ignore queued clicks instead of stacking two.
  if (levelLoading) return;
  i = Math.max(0, Math.min(LEVELS.length - 1, i));
  audio.stopMusic(0.25);
  game.abandonBonus?.();
  game.bossTransition = null;
  game.inputLocked = false;
  // A live boss run resumes in the arena even when the player picks the
  // entrance node; picking that node again from scratch restarts the approach.
  let index = i;
  let resume = null;
  const run = normaliseBossRun(progress.bossRun);
  if (run) {
    const arenaIndex = LEVELS.findIndex((level) => level && level.id === run.arena);
    const entranceIndex = LEVELS.findIndex((level) => level && level.id === run.entrance);
    const fighting = ['arena', 'intro', 'fight', 'win', 'lose'].includes(run.stage);
    if (fighting && arenaIndex >= 0 && (i === arenaIndex || i === entranceIndex)) {
      // A live fight always resumes in the arena, even when the player picks
      // the entrance node (the map only knows the entrance).
      index = arenaIndex;
      resume = run;
    } else if (run.stage === 'approach' && i === entranceIndex) {
      // Quitting during the scroll advance resumes at the last sector
      // checkpoint instead of throwing the run away.
      resume = run;
    } else if (i === entranceIndex) {
      progress.bossRun = null;
      saveProgress();
    }
  }
  game.bossResume = resume;
  // The level object is built synchronously, then the yellow screen holds until
  // its art has decoded. Freezing the state is what keeps cats from walking
  // (and the timer from running) while the player still sees the loader.
  levelLoading = true;
  loader.show();
  game.loadLevel(LEVELS[index], index);
  game.state = 'loading';
  progress.last = i;
  saveProgress();
  loader.setProgress(0.35);
  void (async () => {
    try {
      await warmLevelArt(game, (p) => loader.setProgress(0.35 + p * 0.6));
    } catch {
      /* a missing background must never block the level */
    } finally {
      loader.setProgress(1);
      await loader.hide();
      if (game.state === 'loading') game.state = 'playing';
      levelLoading = false;
    }
  })();
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
    // The world map only knows the ENTRANCE map of a boss chapter, while the
    // fight runs in the arena map (native autostart). Record completion against
    // the entrance index or the map node would never turn "done".
    const cleared = LEVELS[level] || null;
    const link = cleared ? arenaLink(cleared.id) : null;
    const entranceIndex = link ? LEVELS.findIndex((def) => def && def.id === link.entrance) : -1;
    const recorded = entranceIndex >= 0 ? entranceIndex : level;
    if (!progress.done.includes(recorded)) progress.done.push(recorded);
    if (link) {
      const previous = progress.boss[link.num] || {};
      progress.boss[link.num] = {
        cleared: true,
        clears: (previous.clears || 0) + 1,
        attempts: game.bossRun?.attempts || previous.attempts || 1,
        at: Date.now(),
      };
      // The run is finished; a later replay starts a fresh attempt.
      progress.bossRun = null;
    }
    progress.last = Math.min(recorded + 1, LEVELS.length - 1);
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
  // The loader is already painted by index.html; drive it with real milestones.
  loader.show();
  try {
    const content = await loadContent((progress) => loader.setProgress(0.04 + progress * 0.7));
    LEVELS = content.levels;
    SOURCE = content.source;
    window.__levels = LEVELS;
    game.levelCatalog = LEVELS;
    for (const tag of progress.dossiers) game.dossiers.add(tag);
    for (const id of progress.secrets) game.secretsFound.add(id);
    // Reward rooms already paid in a previous session stay closed.
    game.bonusClaims = { ...(progress.bonus || {}) };
    game.crackClaims = { ...(progress.cracks || {}) };
    loader.setProgress(0.78);
    const menuRoot=document.getElementById('frontEnd');
    if(menuRoot && typeof menuRoot.querySelector==='function') {
      try {
        const response=await fetch('assets/menu/worlds.json');
        if(!response.ok)throw new Error('world menu data unavailable');
        const worlds=await response.json();
        frontEnd=new FrontEnd(menuRoot,LEVELS,worlds,{
          getProgress:()=>progress,
          onPlay:index=>{game.language=frontEnd?.settings.language==='en'?'en':'zh';hideOverlay();startLevel(index);},
          onErase:()=>{progress.done=[];progress.last=0;progress.dossiers=[];progress.secrets=[];progress.boss={};progress.bonus={};progress.cracks={};progress.bossRun=null;game.dossiers.clear();game.secretsFound.clear();game.bonusClaims={};game.crackClaims={};saveProgress();},
        });
        game.language = frontEnd.settings.language === 'en' ? 'en' : 'zh';
      } catch(error) {console.warn('original menu could not load',error);}
    }
    // Decode the home-stage art behind the loader so the menu does not appear
    // one image at a time when the yellow screen fades.
    loader.setProgress(0.86);
    await loadImages(MENU_ART, (p) => loader.setProgress(0.86 + p * 0.08));
    if (SOURCE === "builtin") {
      console.warn("Imported content not found - using built-in sample levels.");
    }
    const first = Math.max(0, Math.min(progress.last, LEVELS.length - 1));
    if (LEVELS[first]) game.loadLevel(LEVELS[first], first);
    game.state = "menu";
    game.emitHud();
    hudLives.textContent = "";
    hudCheese.textContent = "0";
    if (hudScore) hudScore.textContent = "";
    loader.setProgress(1);
    // Paint the menu underneath first: the loader then fades out onto a settled
    // screen instead of flashing the bare canvas.
    showOverlay(frontEnd?'home':'menu');
  } finally {
    requestAnimationFrame(frame);
    await loader.hide();
  }
}

boot();

