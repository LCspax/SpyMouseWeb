import {LEVEL_TITLES} from './level-titles.js';
import {audio} from './audio.js';

// Native reference (ui lane findings):
//   results screen counts the score up over `results_count_time` (fcn.0xe7d60),
//   loops ui_scorecount_loop.sps while counting (id 145) and steps through
//   score_note01..13 (ids 124-136) as the value rises; the time bonus lands with
//   score_bonus (137).  Star medals pop in one after another (starfade_speed).
export const RESULTS_COUNT_TIME = 1.2;

function nowMs() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
  return Date.now();
}
/** requestAnimationFrame that also works in Node/smoke (falls back to a timer). */
function raf(cb) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(() => cb(nowMs()), 16);
}
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const NOTE_FIRST = 124;
const NOTE_LAST = 136;

const GOALS = {
  paths: ['star_path', n=>`最多画 ${n} 条路线`],
  bump: ['star_catdizzy', n=>`${n} 只猫撞墙`],
  score: ['star_score', n=>`获得 ${n} 分`],
  time: ['star_time', n=>`${n} 秒内完成`],
  spotted: ['star_catspot', n=>`被发现 ${n} 次`],
  all_crumbs: ['star_crumbs', ()=>`收集全部奶酪碎屑`],
  pipe: ['star_pipes', n=>`最多使用 ${n} 次管道`],
  mouse_hole: ['star_mousehole', n=>`最多使用 ${n} 次鼠洞`],
  balloon: ['star_balloon', n=>`最多使用 ${n} 个气球`],
  bucket: ['star_bucket', n=>`最多使用 ${n} 个水桶`],
  chilli: ['star_chilli', n=>`最多使用 ${n} 个辣椒`],
  fish: ['star_fish', n=>`最多使用 ${n} 条鱼`],
  string: ['star_string', n=>`最多使用 ${n} 个线团`],
  teacup: ['star_coffee', n=>`最多使用 ${n} 个茶杯`],
  furniture: ['star_furniture', n=>`最多经过 ${n} 次家具`],
  switch: ['star_button', n=>`最多使用 ${n} 次开关`],
  tv: ['star_tv', n=>`最多使用 ${n} 次电视`],
  stolen: ['star_thief', ()=>`没有奶酪被偷走`],
  safe_hole: ['star_cheesesafe', n=>`最多使用 ${n} 次安全洞`],
  shuriken_cheese: ['star_ninjastar', n=>`收集 ${n} 块飞镖奶酪`],
  dark_areas: ['star_light', n=>`最多经过 ${n} 次黑暗区域`],
};
for(const [type,label] of Object.entries({pair:'对子',triple:'三条',twopair:'两对',straight:'顺子',fullhouse:'满堂红',flush:'同花'})) {
  GOALS[`combo_${type}`]=['star_score',n=>`完成 ${n} 次${label}组合`];
}

export function resultsModel(level, settlement = {}, language = 'zh') {
  const title = LEVEL_TITLES[level.name] || (level.name?.startsWith('LEVEL_') ? `${language==='en'?'Level':'关卡'} ${level.num || ''}` : level.name || '');
  const elapsed = Math.max(0, Math.floor(settlement.elapsed || 0));
  return {
    title, language, number: level.num || '', points: settlement.banked || 0,
    bonus: settlement.timeBonus || 0, total: settlement.final || 0,
    time: `${Math.floor(elapsed/60)}m ${elapsed%60}s`,
    goals: (settlement.goals || []).slice(0,3).map(goal=>{
      const type = Array.isArray(goal.type) ? goal.type[0] : goal.type;
      const value = Array.isArray(goal.value) ? goal.value[0] : goal.value;
      const [icon,label] = GOALS[type] || ['star_score', ()=>`关卡目标`];
      const describe=(type,value)=>language==='en' ? ({paths:`At most ${value} paths`,bump:`${value} cats hit walls`,score:`Score ${value} points`,time:`Finish in ${value} seconds`,spotted:`Spotted ${value} times`,all_crumbs:'Collect all cheese crumbs'}[type] || `${type.replaceAll('_',' ')}: ${value ?? ''}`) : (GOALS[type]?.[1] || (()=>'关卡目标'))(value);
      const description=Array.isArray(goal.type) ? goal.type.map((t,i)=>describe(t,goal.value?.[i])).join(' · ') : describe(type,value);
      return { icon, label: description, earned: goal.pass === true };
    }),
  };
}

/**
 * Count `to` up from 0 over `durationSec`, easing out, with the native score
 * notes stepping as the value rises.  Returns a cancel function.
 */
function countUp(el, to, durationSec, { onNote = null, onDone = null } = {}) {
  const target = Number.isFinite(Number(to)) ? Number(to) : 0;
  if (!el) { if (onDone) onDone(); return () => {}; }
  if (!durationSec || durationSec <= 0 || target === 0) {
    el.textContent = String(target);
    if (onDone) onDone();
    return () => {};
  }
  let started = null;
  let cancelled = false;
  let lastNote = -1;
  const step = (now) => {
    if (cancelled) return;
    if (started === null) started = now;
    const t = Math.min(1, Math.max(0, (now - started) / (durationSec * 1000)));
    const eased = easeOutCubic(t);
    const shown = Math.round(target * eased);
    el.textContent = String(t === 1 ? target : shown);
    if (onNote) {
      const note = Math.min(NOTE_LAST - NOTE_FIRST, Math.floor(eased * (NOTE_LAST - NOTE_FIRST + 1)));
      if (note > lastNote) { lastNote = note; onNote(note, t); }
    }
    if (t < 1) raf(step);
    else if (onDone) onDone();
  };
  raf(step);
  return () => { cancelled = true; };
}

export function renderResults(container, model, options = {}) {
  const animate = options.animate !== false;
  const duration = Number.isFinite(Number(options.countDuration)) ? Number(options.countDuration) : RESULTS_COUNT_TIME;
  const english=model.language==='en';
  container.innerHTML = '';
  const make = (tag, className, text) => {
    const el=document.createElement(tag);el.className=className;
    if(text!=null)el.textContent=String(text);return el;
  };
  const rows=make('div','result-scores');
  const counters=[];
  for(const [icon,label,value] of [['cheese',english?'Points':'点数',model.points],['clock',english?'Time Bonus':'时间奖励',model.bonus]]) {
    const row=make('div','result-score-row');
    row.appendChild(make('span',`result-icon ${icon}`));
    row.appendChild(make('span','',label));
    const number=make('strong','', animate ? 0 : value);
    row.appendChild(number);rows.appendChild(row);
    counters.push({ el: number, value: Number(value) || 0, kind: icon });
    if(icon==='clock')rows.appendChild(make('div','result-duration',`(${model.time})`));
  }
  const total=make('div','result-total');
  total.appendChild(make('span','',english?'Total:':'总分数：'));
  const totalNumber=make('strong','', animate ? 0 : model.total);
  total.appendChild(totalNumber);rows.appendChild(total);
  container.appendChild(rows);

  // Score count-up: ui_scorecount_loop (145) while counting, score notes on the
  // way up, score_bonus (137) when it finishes.  Skipped when the overlay is
  // rebuilt without animation (e.g. resize/refresh paths).
  if (animate) {
    let active = 0;
    const release = () => {
      active -= 1;
      if (active <= 0) audio.stopSound(145);
    };
    active += 1;
    audio.playSound(145, { loop: true, priority: 7, volume: 0.7 });
    const onNote = (note) => {
      // 13 notes over the whole roll; keep them audible but not machine-gun fast.
      if (note % 2 !== 0) return;
      audio.playSound(NOTE_FIRST + Math.min(12, note), { priority: 6, volume: 0.55 });
    };
    for (const c of counters) {
      countUp(c.el, c.value, duration, { onNote, onDone: () => { if (c.kind === 'clock') audio.playSound(137, { priority: 6 }); } });
    }
    countUp(totalNumber, Number(model.total) || 0, duration, { onDone: release });
  }

  const goals=make('div','result-medals');
  const goalList = model.goals || [];
  goalList.forEach((goal, index) => {
    const badge=make('button',`result-medal${goal.earned ? ' earned' : ' missed'}`);badge.type='button';badge.title=goal.label;
    if (animate) badge.style.animationDelay = `${index * 120}ms`;
    const image=make('img','');image.src=`assets/ui/${goal.icon}${goal.earned?'_gold':''}.png`;
    image.alt=`${goal.label}：${english?(goal.earned?'Earned':'Not earned'):(goal.earned?'已获得':'未获得')}`;badge.appendChild(image);
    const description=()=>container.querySelector?.('.result-goal-description');
    badge.addEventListener('click',()=>{const d=description();if(d)d.textContent=goal.label;});
    goals.appendChild(badge);
  });
  container.appendChild(goals);
  const description=make('div','result-goal-description',goalList.find(g=>g.earned)?.label || goalList[0]?.label || '关卡完成');
  container.appendChild(description);
}
