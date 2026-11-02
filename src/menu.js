import { resultsModel } from './results.js';
import {nodePoint,snapMapPath,advanceMapWalk,mapRoadPath,extendMapRoadPath} from './map-walk.js';
import {audio} from './audio.js';
import {showAchievementPopup, loadTutorials, showTutorialById} from './popups.js';

export const SETTINGS_KEY='spymouse.settings.v1';
// Module-level cache: assets/ui/dossiers.json is loaded once per page.
const DOSSIER_CACHE={data:null,promise:null};
export function normaliseSettings(value={}) {
  if(!value || typeof value!=='object')value={};
  const volume=(n,fallback)=>Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;
  return {effects:volume(value.effects,.8),music:volume(value.music,.55),language:value.language==='en'?'en':'zh'};
}
export function worldNodes(world,levels,foundSecrets=null) {
  const found=new Set(foundSecrets||[]);
  const filterSecrets=Array.isArray(foundSecrets);
  return world.nodes.map(node=>({...node,index:levels.findIndex(level=>level.id===node.levelId)}))
    // Secret levels are hidden on the world map until their wall crack has
    // been pushed open (native `secret="true"` + found_secret_level metric).
    .filter(node=>node.index>=0&&(!filterSecrets||!levels[node.index]?.secret||found.has(levels[node.index].id)));
}
const TEXT={
  zh:{
    start:'开始游戏！',play:'游戏！',options:'选项',effects:'音效',music:'音乐',language:'选择语言',erase:'清除游戏存档',back:'返回',help:'玩法帮助',bag:'关卡列表',achievements:'完成记录',progressLabel:'进度',sponsor:'赞助',cancel:'取消',confirm:'确认清除',
    eraseText:'清除所有关卡完成记录？此操作无法撤销。',
    helpText:'从地图上的主角开始画线，松手后跟随路线移动；在关卡点附近结束路线会吸附停下，点击旁边的“游戏！”进入。也可以直接点击关卡点走过去。画线引导老鼠收集奶酪并回到出口。避开猫，利用拐角、鼠洞和管道甩开追捕。',
    world:'场景',
    backpack:'背包',collected:'已收集',dossierBack:'返回档案',dossierLocked:'???',
    dossierHint:'在关卡里找到档案后解锁',dossierUnknown:'未解锁',
    portraitHint:'横屏游玩最佳',
  },
  en:{
    start:'Play!',play:'Play!',options:'Options',effects:'Sound',music:'Music',language:'Language',erase:'Erase Game Progress',back:'Back',help:'How to Play',bag:'All Levels',achievements:'Progress',progressLabel:'Progress',sponsor:'Sponsor',cancel:'Cancel',confirm:'Erase Progress',
    eraseText:'Erase all level completion records? This cannot be undone.',
    helpText:'Draw from the mouse on the map, then release to walk. End near a level node to stop there, then press the Play button beside it. You can also click a node to walk to it. Draw a path to collect cheese and reach the exit. Avoid cats and use corners, mouse holes and pipes to escape.',
    world:'World',
    backpack:'BACKPACK',collected:'Collected',dossierBack:'Back',dossierLocked:'???',
    dossierHint:'Find dossiers in levels to unlock them',dossierUnknown:'Locked',
    portraitHint:'Best played in landscape',
  },
};

export class FrontEnd {
  constructor(root,levels,worlds,callbacks) {
    this.root=root;this.levels=levels;this.worlds=worlds;this.callbacks=callbacks;
    try{this.settings=normaliseSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}'));}catch{this.settings=normaliseSettings();}
    this.world=worlds[0];this.selected=0;this.view='home';
    this.buildingCache={};this.buildingWorlds=null;this.buildingIndexPromise=null;this.buildings=[];
    this.musicName=null;
    this.applyVolumes();
    root.innerHTML=`<div class="menu-backdrop"></div><div class="menu-stage home-stage">
      <img class="menu-logo" src="assets/menu/logo.png" alt="SPY mouse">
      <div class="menu-mouse"><img class="mouse-body" src="assets/menu/mm_mouse.png" alt="Agent Squeak"><img class="mouse-eyes" src="assets/menu/mm_mouse_open.png" alt=""></div>
      <img class="menu-cheese" src="assets/menu/main_menu_cheese.png" alt="">
      <button class="menu-start" data-action="start"></button>
    </div><div class="home-badges">
      <div class="badge"><button class="art-button trophy-button" data-action="achievements"></button><span class="badge-label" data-badge="achievements"></span></div>
      <div class="badge"><a class="art-button sponsor-button" data-action="sponsor" href="https://afdian.com/a/lcspax" target="_blank" rel="noopener noreferrer"></a><span class="badge-label" data-badge="sponsor"></span></div>
    </div><div class="menu-stage world-stage">
      <img class="world-picture" alt=""><div class="map-buildings" aria-hidden="true"></div><svg class="map-drawing" viewBox="0 0 960 640" aria-hidden="true"><polyline/></svg>
      <div class="world-nodes"></div><div class="world-mouse" aria-hidden="true"></div>
      <div class="world-heading"><span class="world-title"></span><div class="world-switch"><button data-action="previous" aria-label="上一个场景">‹</button><select aria-label="选择场景"></select><button data-action="next" aria-label="下一个场景">›</button></div></div><button class="art-button map-back" data-action="home"></button>
      <button class="art-button backpack-button" data-action="bag"></button>
      <button class="map-play" data-action="play"></button>
    </div><div class="menu-utility"><button class="art-button settings-button" data-action="settings"></button><button class="art-button help-button" data-action="help"></button></div>
    <div class="portrait-hint" role="note"><span class="portrait-hint-icon" aria-hidden="true"></span><span class="portrait-hint-text"></span></div>
    <div class="menu-modal" hidden><button class="art-button modal-back" data-action="dismiss"></button><section class="options-card"><h1></h1><div class="modal-body"></div></section></div>`;
    root.addEventListener('click',event=>{
      const action=event.target.closest('[data-action]')?.dataset.action;
      if(!action)return;this.sound(action==='dismiss'||action==='home'?2:1);
      if(action==='start')this.showWorld();
      if(action==='home')this.showHome();
      if(action==='play')this.activateMapPlay();
      if(action==='settings')this.showOptions();
      if(action==='help')this.showHelp();
      if(action==='achievements')this.showAchievements();
      if(action==='bag')this.showBackpack();
      if(action==='dismiss'){ if(this.dossierOpen)this.showBackpack(175); else this.dismiss(); }
      if(action==='previous'||action==='next'){
        const i=this.worlds.indexOf(this.world),delta=action==='next'?1:-1;
        this.setWorld(this.worlds[(i+delta+this.worlds.length)%this.worlds.length]);
      }
    });
    const select=this.find('.world-switch select');
    for(const world of worlds){const option=document.createElement('option');option.value=world.id;option.textContent=`${this.text.world} ${world.id}`;select.appendChild(option);}
    select.addEventListener('change',()=>this.setWorld(worlds.find(world=>world.id===+select.value)));
    root.addEventListener('pointerdown',()=>this.unlockAudio());
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape'){ if(this.dossierOpen)this.showBackpack(175); else this.dismiss(); }
      this.unlockAudio();
    });
    this.bindMapDrawing();
    window.addEventListener('resize',()=>this.resize());this.resize();this.translate();
  }
  get text(){return TEXT[this.settings.language];}
  find(selector){return this.root.querySelector(selector);}
  resize(){this.root.style.setProperty('--menu-scale',Math.min(window.innerWidth/960,window.innerHeight/640));}
  applyVolumes(){audio.setVolumes({music:this.settings.music,effects:this.settings.effects});}
  saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(this.settings));}catch{}this.applyVolumes();}
  /** Menu track per view: home=CM_Menu1, world=CM_Menu2, modal=CM_Menu3. */
  musicFor(view){return view==='world'?'CM_Menu2':view==='modal'?'CM_Menu3':'CM_Menu1';}
  playViewMusic(view=this.view){this.musicName=this.musicFor(view);audio.playMusic(this.musicName,{loop:true,fade:.35});}
  unlockAudio(){audio.unlock();if(!this.root.hidden&&this.settings.music>0)this.playViewMusic(this.view);}
  sound(id=1){audio.unlock();audio.playSound(id,{priority:6});}
  /** Native cross-fade between views: ui_woosh (140) / ui_woosh_quick (175). */
  playTransition(quick=false){audio.playSound(quick?175:140,{priority:5,volume:.8});}
  animateStageSwap(){
    const el=this.root;
    if(!el||!el.classList)return;
    el.classList.remove('stage-swap');
    if(typeof el.offsetWidth==='number')void el.offsetWidth;
    el.classList.add('stage-swap');
    clearTimeout(this.stageTimer);
    this.stageTimer=setTimeout(()=>el.classList.remove('stage-swap'),280);
  }
  translate(){
    this.root.lang=this.settings.language==='en'?'en':'zh-CN';
    const labels={start:this.text.start,play:this.text.play,settings:this.text.options,help:this.text.help,home:this.text.back,bag:this.text.backpack,achievements:this.text.achievements,sponsor:this.text.sponsor,dismiss:this.text.back};
    for(const [action,label] of Object.entries(labels)){
      const button=this.find(`[data-action="${action}"]`);button.setAttribute('aria-label',label);button.title=label;
      if(action==='start'||action==='play')button.textContent=label;
    }
    const badgeLabels={achievements:this.text.progressLabel,sponsor:this.text.sponsor};
    for(const [key,label] of Object.entries(badgeLabels)){
      const badge=this.find(`[data-badge="${key}"]`);if(badge)badge.textContent=label;
    }
    for(const option of this.find('.world-switch select').options)option.textContent=`${this.text.world} ${option.value}`;
    const portraitHint=this.find('.portrait-hint-text');
    if(portraitHint)portraitHint.textContent=this.text.portraitHint;
    this.find('[data-action="previous"]').setAttribute('aria-label',this.settings.language==='en'?'Previous World':'上一个场景');
    this.find('[data-action="next"]').setAttribute('aria-label',this.settings.language==='en'?'Next World':'下一个场景');
    this.find('.world-switch select').setAttribute('aria-label',this.settings.language==='en'?'Choose World':'选择场景');
    const exit=this.find('.map-node[data-index="next"]'),nextLabel=this.settings.language==='en'?'Next Chapter':'下一章';
    if(exit){exit.setAttribute('aria-label',nextLabel);exit.title=nextLabel;}
    if(this.selected==='next'){const play=this.find('.map-play');play.textContent=nextLabel;play.setAttribute('aria-label',nextLabel);this.find('.world-title').textContent=`${nextLabel} · ${this.world.id+1}`;}
  }
  open(view){
    this.root.hidden=false;this.root.inert=false;this.view=view;
    this.root.dataset.view=view;this.dismiss();this.resize();
    this.animateStageSwap();
    this.playTransition(false);
    this.playViewMusic(view);
    if(view==='home')this.startHomeIdle();else this.stopHomeIdle();
  }
  close(){this.cancelMapWalk();this.stopHomeIdle();this.root.hidden=true;this.root.inert=true;audio.stopMusic(.3);}
  showHome(){this.cancelMapWalk();this.open('home');}
  foundSecrets(){
    const p=this.callbacks.getProgress?.();
    return Array.isArray(p?.secrets)?p.secrets:[];
  }
  showWorld(){
    this.open('world');const next=this.callbacks.getProgress().last||0;
    const world=this.worlds.find(world=>worldNodes(world,this.levels,this.foundSecrets()).some(node=>node.index===next));
    this.setWorld(world||this.world,next);this.unlockAudio();
  }
  setWorld(world,preferred){
    this.cancelMapWalk();
    const previousWorld=this.world;
    this.world=world;this.selectedMapNode=null;const nodes=worldNodes(world,this.levels,this.foundSecrets());this.nodes=nodes;
    if(previousWorld&&previousWorld!==world){this.playTransition(true);audio.playSound(139,{priority:5,volume:.8});}
    if(world.exit&&this.worlds.indexOf(world)<this.worlds.length-1)nodes.push({...world.exit,index:'next',kind:'next'});
    this.find('.world-picture').src=world.image;this.root.style.setProperty('--world-image',`url("${world.image}")`);
    this.renderBuildings(world);
    this.ensureBuildingData(world);
    this.find('.world-switch select').value=world.id;
    const parent=this.find('.world-nodes');parent.replaceChildren();
    // An unfinished boss run marks its chapter node so a pause/reload is
    // resumable straight from the map, and the label says so.
    const bossRun=this.callbacks.getProgress?.()?.bossRun||null;
    for(const [order,node] of nodes.entries()){
      const button=document.createElement('button');button.className='map-node';button.style.left=`${node.x*2}px`;button.style.top=`${node.y*2}px`;
      button.style.setProperty('--node-order',String(order));
      const level=this.levels[node.index],name=node.kind==='next'?(this.settings.language==='en'?'Next Chapter':'下一章'):resultsModel(level).title;
      button.setAttribute('aria-label',node.kind==='next'?name:`${level.num||level.id} ${name}`);button.title=button.getAttribute('aria-label');
      const done=this.callbacks.getProgress().done.includes(node.index),frame=node.kind==='next'?6:done?2:level.mode==='boss'||level.mode==='infinite'?4:0;
      button.style.backgroundPosition=`${frame*100/7}% center`;
      if(bossRun&&level&&(bossRun.entrance===level.id||bossRun.arena===level.id)){
        const resumeLabel=this.settings.language==='en'?' (Continue)':'（继续挑战）';
        button.classList.add('boss-resume');
        button.setAttribute('aria-label',button.getAttribute('aria-label')+resumeLabel);
        button.title=button.getAttribute('aria-label');
      }
      button.addEventListener('click',()=>{if(Date.now()<this.suppressMapClickUntil)return;this.sound(42);this.walkToNode(node);});button.dataset.index=node.index;parent.appendChild(button);
    }
    const index=nodes.some(node=>node.index===preferred)?preferred:nodes[0]?.index;
    this.selectNode(index??0);
  }
  selectNode(index,placeMouse=true){
    this.selected=index;const level=this.levels[index],node=this.nodes.find(node=>node.index===index);
    this.selectedMapNode=node;
    this.find('.world-title').textContent=index==='next'?`${this.settings.language==='en'?'Next Chapter':'下一章'} · ${this.world.id+1}`:`${level.num||''} ${resultsModel(level).title}`;
    for(const button of this.find('.world-nodes').children){
      const on=button.dataset.index===String(index);
      button.classList.toggle('selected',on);
    }
    this.bounceBuilding(node);
    const marker=this.find('.world-mouse');marker.hidden=!node;
    if(node&&placeMouse){this.mapPosition=nodePoint(node);this.renderMapMouse();}
    this.placeMapPlay(node);
  }
  cancelMapWalk(){
    if(this.mapFrame)cancelAnimationFrame(this.mapFrame);
    this.mapFrame=null;this.mapWalk=null;this.mapStroke=null;
    const stage=this.find('.world-stage');
    if(this.mapPointer!=null&&stage.hasPointerCapture(this.mapPointer))stage.releasePointerCapture(this.mapPointer);
    this.mapPointer=null;this.mapPointerStart=null;
    this.find('.map-drawing polyline').setAttribute('points','');
    this.find('.world-mouse').classList.remove('walking');
    this.renderMapMouse();
  }
  placeMapPlay(node){
    const button=this.find('.map-play');button.hidden=!node;
    if(!node)return;
    button.classList.toggle('next-chapter',node.kind==='next');
    button.textContent=node.kind==='next'?(this.settings.language==='en'?'Next Chapter':'下一章'):this.text.play;
    button.setAttribute('aria-label',button.textContent);
    const p=nodePoint(node);
    button.style.left=`${Math.max(8,Math.min(840,p.x+(p.x>770?-138:44)))}px`;
    button.style.top=`${Math.max(95,Math.min(505,p.y-55))}px`;
  }
  renderMapMouse(heading=this.mapHeading??0,time=0){
    if(!this.mapPosition)return;
    this.mapHeading=heading;
    const marker=this.find('.world-mouse'),moving=!!this.mapWalk;
    marker.style.left=`${this.mapPosition.x}px`;marker.style.top=`${this.mapPosition.y+5}px`;
    marker.classList.toggle('walking',moving);
    const row=moving?((Math.round((-heading-Math.PI/2)*8/Math.PI)%16)+16)%16:Math.abs(Math.sin(heading))>Math.abs(Math.cos(heading))?(Math.sin(heading)<0?0:2):(Math.cos(heading)<0?1:3);
    marker.style.backgroundPosition=`${moving?-(Math.floor(time/.08)%4)*64:0}px ${-row*64}px`;
  }
  drawMapPath(points){this.find('.map-drawing polyline').setAttribute('points',points.map(p=>`${p.x},${p.y}`).join(' '));}
  startMapWalk(path,node,immediate=false){
    this.cancelMapWalk();if(immediate)this.selectNode(node.index,false);else this.find('.map-play').hidden=true;
    if(!path.length)return;
    this.mapWalk={position:{...this.mapPosition},path:path.map(p=>({...p})),heading:this.mapHeading??0,node};
    let last=null,elapsed=0;
    const frame=now=>{
      if(!this.mapWalk)return;
      const dt=last===null?0:Math.min(.05,(now-last)/1000);last=now;
      if(this.find('.menu-modal').hidden){
        elapsed+=dt;const finished=advanceMapWalk(this.mapWalk,dt);
        this.mapPosition={...this.mapWalk.position};this.renderMapMouse(this.mapWalk.heading,elapsed);
        this.drawMapPath([this.mapPosition,...this.mapWalk.path]);
        if(finished){const destination=this.mapWalk.node;this.mapWalk=null;this.mapFrame=null;this.drawMapPath([]);if(destination)this.selectNode(destination.index);else this.renderMapMouse();return;}
      }
      this.mapFrame=requestAnimationFrame(frame);
    };
    this.mapFrame=requestAnimationFrame(frame);
  }
  walkToNode(node){this.startMapWalk(mapRoadPath(this.mapPosition,nodePoint(node),this.world.routes),node,true);}
  bindMapDrawing(){
    const stage=this.find('.world-stage');
    const point=event=>{const r=stage.getBoundingClientRect();return{x:(event.clientX-r.left)*960/r.width,y:(event.clientY-r.top)*640/r.height};};
    stage.addEventListener('pointerdown',event=>{
      if(event.button!==0||!this.mapPosition||!this.find('.menu-modal').hidden||event.target.closest('button:not(.map-node),select'))return;
      const p=point(event);if(Math.hypot(p.x-this.mapPosition.x,p.y-this.mapPosition.y)>75)return;
      this.cancelMapWalk();this.mapStroke=[{...this.mapPosition}];this.mapPointer=event.pointerId;this.mapPointerStart=p;
      audio.playSound(43,{priority:5,volume:.7}); // map_path: native path-draw tick
    });
    stage.addEventListener('pointermove',event=>{
      if(event.pointerId!==this.mapPointer||!this.mapStroke)return;
      const p=point(event),prev=this.mapStroke.at(-1);p.x=Math.max(0,Math.min(960,p.x));p.y=Math.max(0,Math.min(640,p.y));
      if(!stage.hasPointerCapture(event.pointerId)&&Math.hypot(p.x-this.mapPointerStart.x,p.y-this.mapPointerStart.y)<10)return;
      if(Math.hypot(p.x-prev.x,p.y-prev.y)>=4&&extendMapRoadPath(this.mapStroke,p,this.world.routes)){
        if(!stage.hasPointerCapture(event.pointerId))stage.setPointerCapture(event.pointerId);
        this.find('.map-play').hidden=true;this.drawMapPath(this.mapStroke);
      }
    });
    const finish=(event,cancelled=false)=>{
      if(event.pointerId!==this.mapPointer||!this.mapStroke)return;
      const points=this.mapStroke,travel=points.reduce((sum,p,i)=>sum+(i?Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y):0),0);
      this.mapStroke=null;this.mapPointer=null;if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);
      if(cancelled||travel<12){this.drawMapPath([]);this.placeMapPlay(this.nodes.find(n=>Math.hypot(n.x*2-this.mapPosition.x,n.y*2-this.mapPosition.y)<2));return;}
      this.suppressMapClickUntil=Date.now()+350;
      const {node}=snapMapPath(points,this.nodes);
      const extension=node?mapRoadPath(points.at(-1),nodePoint(node),this.world.routes):[];
      this.startMapWalk([...points,...extension],extension.length?node:null);
    };
    stage.addEventListener('pointerup',event=>finish(event));stage.addEventListener('pointercancel',event=>finish(event,true));
    stage.addEventListener('pointerleave',event=>{if(!stage.hasPointerCapture(event.pointerId))finish(event,true);});
  }
  activateMapPlay(){
    if(this.selected==='next'){
      const next=this.worlds[this.worlds.indexOf(this.world)+1];if(next)this.setWorld(next);
    }else this.play(this.selected);
  }
  play(index){this.close();this.callbacks.onPlay(index);}
  modal(title,soundId=null,mode=null){
    const modalEl=this.find('.menu-modal');
    modalEl.hidden=false;
    modalEl.classList.remove('backpack-mode','dossier-mode');
    if(mode==='backpack')modalEl.classList.add('backpack-mode');
    for(const part of this.root.querySelectorAll('.menu-stage,.menu-utility,.home-badges'))part.inert=true;
    this.find('.options-card h1').textContent=title;
    const body=this.find('.modal-body');body.classList.remove('catalog-body','settings-body','backpack-body','dossier-body');body.replaceChildren();
    this.dossierOpen=false;
    if(soundId!=null)audio.playSound(soundId,{priority:6});else this.playTransition(true);
    this.playViewMusic('modal');
    this.find('.modal-back').focus();return body;
  }
  dismiss(){
    const wasOpen=!this.find('.menu-modal').hidden;
    this.find('.menu-modal').hidden=true;
    this.find('.menu-modal').classList.remove('backpack-mode','dossier-mode');
    this.dossierOpen=false;
    for(const part of this.root.querySelectorAll('.menu-stage,.menu-utility,.home-badges'))part.inert=false;
    if(wasOpen){this.playTransition(true);this.playViewMusic(this.view);}
  }
  button(parent,label,handler){const button=document.createElement('button');button.className='menu-long';button.textContent=label;button.addEventListener('click',()=>{this.sound(1);handler();});parent.appendChild(button);return button;}
  showOptions(){
    const body=this.modal(this.text.options);body.classList.add('settings-body');
    for(const [key,label] of [['effects',this.text.effects],['music',this.text.music]]){
      const wrapper=document.createElement('label');wrapper.className='volume-control';wrapper.textContent=label;
      const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='100';slider.value=Math.round(this.settings[key]*100);slider.setAttribute('aria-label',label);
      slider.addEventListener('input',()=>{this.settings[key]=+slider.value/100;this.saveSettings();if(key==='music')this.unlockAudio();});
      slider.addEventListener('change',()=>this.sound(74)); // ui_slider_set
      slider.addEventListener('pointerup',()=>audio.playSound(75,{priority:5,volume:.7})); // ui_snap
      wrapper.appendChild(slider);body.appendChild(wrapper);
    }
    this.button(body,this.text.language,()=>this.showLanguages());
    this.button(body,this.text.erase,()=>this.showErase());
    const disclaimer=document.createElement('p');disclaimer.className='menu-disclaimer';
    disclaimer.textContent=this.settings.language==='en'?'Disclaimer: I am not affiliated with EA or its Spy Mouse game. This project is provided for trial play only.':'免责声明：本人与 EA 开发的《间谍鼠》无任何关系，此项目只提供试玩。';body.appendChild(disclaimer);
  }
  showLanguages(){const body=this.modal(this.text.language);for(const [language,label] of [['zh','简体中文'],['en','English']])this.button(body,label,()=>{this.settings.language=language;this.saveSettings();this.translate();this.showOptions();});}
  showErase(){const body=this.modal(this.text.erase);const text=document.createElement('p');text.textContent=this.text.eraseText;body.appendChild(text);this.button(body,this.text.cancel,()=>this.showOptions());this.button(body,this.text.confirm,()=>{this.callbacks.onErase();this.setWorld(this.worlds[0],0);this.showOptions();});}
  showHelp(){
    const body=this.modal(this.text.help),text=document.createElement('p');text.textContent=this.text.helpText;body.appendChild(text);
    // Tutorial data path (native popup_tutorials/*.xml -> assets/ui/tutorials.json).
    // Absent file / fetch failure => no buttons, no error.
    loadTutorials().then(tutorials=>{
      if(!tutorials.length)return;
      for(const tutorial of tutorials.slice(0,3)){
        this.button(body,tutorial.titleId||tutorial.id,()=>showTutorialById(tutorial.id,{host:this.root}));
      }
    }).catch(()=>{});
  }
  showAchievements(){
    const progress=this.callbacks.getProgress();
    audio.playSound(0,{priority:7}); // ui_achievement
    showAchievementPopup({
      host:this.root,
      title:this.text.achievements,
      done:progress.done.length,
      total:this.levels.length,
      language:this.settings.language,
      onClose:()=>this.dismiss(),
    });
  }
  // ---- home hero idle (native Posed Mouse, HYPOTHESIS: 4 eye frames) -----
  startHomeIdle(){
    this.stopHomeIdle();
    const eyes=this.find('.mouse-eyes');
    if(!eyes)return;
    const FRAMES={open:'assets/menu/mm_mouse_open.png',left:'assets/menu/mm_mouse_left.png',right:'assets/menu/mm_mouse_right.png',closed:'assets/menu/mm_mouse_closed.png'};
    const set=name=>{if(this.mouseEyes===name)return;this.mouseEyes=name;eyes.src=FRAMES[name];};
    const later=(fn,ms)=>{this.homeIdleTimer=setTimeout(fn,ms);};
    const blink=()=>{
      set('closed');
      later(()=>{set('open');later(glance,700+Math.random()*1400);},120+Math.random()*40);
    };
    const glance=()=>{
      const dir=Math.random()<.5?'left':'right';
      set(dir);
      later(()=>{set('open');later(blink,900+Math.random()*1800);},400+Math.random()*400);
    };
    later(glance,1200+Math.random()*1200);
  }
  stopHomeIdle(){
    if(this.homeIdleTimer){clearTimeout(this.homeIdleTimer);this.homeIdleTimer=null;}
    this.mouseEyes='open';
    const eyes=this.find('.mouse-eyes');
    if(eyes)eyes.src='assets/menu/mm_mouse_open.png';
  }
  // ---- independent map buildings + selected-house bounce -----------------
  // The scene image is the road/grass render without building meshes; each
  // house is a transparent PNG extracted at its native position. Only the
  // selected house animates, never the level button or the whole map.
  async ensureBuildingData(world){
    if(!this.buildingIndexPromise){
      this.buildingIndexPromise=(async()=>{
        try{
          if(typeof fetch!=='function')return (this.buildingWorlds=new Set());
          const response=await fetch('assets/menu/buildings/index.json',{cache:'no-cache'});
          const list=response.ok?await response.json():[];
          this.buildingWorlds=new Set((Array.isArray(list)?list:[]).map(entry=>entry.world));
        }catch{this.buildingWorlds=new Set();}
        return this.buildingWorlds;
      })();
    }
    await this.buildingIndexPromise;
    if(!this.buildingWorlds?.has(world.id)||this.buildingCache[world.id])return;
    try{
      const response=await fetch(`assets/menu/buildings/world-${world.id}/buildings.json`,{cache:'no-cache'});
      if(!response.ok)return;
      this.buildingCache[world.id]=await response.json();
      if(this.world?.id===world.id&&this.view==='world')this.renderBuildings(world);
    }catch{/* optional decoration: keep the composite scene */}
  }
  renderBuildings(world){
    const container=this.find('.map-buildings');
    if(!container)return;
    const data=this.buildingCache[world.id];
    if(!data){this.buildings=[];container.replaceChildren();return;}
    if(data.scene)this.find('.world-picture').src=data.scene;
    container.replaceChildren();
    this.buildings=[];
    const list=[...(data.buildings||[])].sort((a,b)=>a.cy-b.cy);
    for(const building of list){
      const img=document.createElement('img');
      img.className='map-building';img.alt='';
      img.src=building.file;
      img.style.left=`${building.x}px`;img.style.top=`${building.y}px`;
      img.style.width=`${building.w}px`;img.style.height=`${building.h}px`;
      img.dataset.buildingId=building.id;
      container.appendChild(img);
      this.buildings.push({...building,el:img});
    }
    if(this.selectedMapNode)this.bounceBuilding(this.selectedMapNode);
  }
  bounceBuilding(node){
    if(!node||typeof node.x!=='number'||!this.buildings?.length)return;
    const px=node.x*2,py=node.y*2;
    let best=null,bestD=Infinity;
    for(const building of this.buildings){
      const d=(building.cx-px)**2+(building.cy-py)**2;
      if(d<bestD){bestD=d;best=building;}
    }
    if(best)this.bounceElement(best.el);
  }
  bounceElement(el){
    if(!el||!el.classList)return;
    const cl=el.classList;
    if(typeof cl.remove==='function')cl.remove('bounce');
    if(typeof el.offsetWidth==='number')void el.offsetWidth;
    if(typeof cl.add==='function')cl.add('bounce');
    if(typeof setTimeout==='function'){
      clearTimeout(el.__bounceTimer);
      el.__bounceTimer=setTimeout(()=>{
        const list=el.classList;
        if(list&&typeof list.remove==='function')list.remove('bounce');
      },560);
    }
  }
  // ---- backpack / dossiers ------------------------------------------------
  async loadDossiers(){
    if(DOSSIER_CACHE.data)return DOSSIER_CACHE.data;
    if(DOSSIER_CACHE.promise)return DOSSIER_CACHE.promise;
    DOSSIER_CACHE.promise=(async()=>{
      try{
        if(typeof fetch!=='function')return (DOSSIER_CACHE.data=[]);
        const res=await fetch('assets/ui/dossiers.json',{cache:'no-cache'});
        if(!res||!res.ok)return (DOSSIER_CACHE.data=[]);
        const data=await res.json();
        DOSSIER_CACHE.data=Array.isArray(data&&data.dossiers)?data.dossiers:[];
      }catch{DOSSIER_CACHE.data=[];}
      return DOSSIER_CACHE.data;
    })();
    return DOSSIER_CACHE.promise;
  }
  async showBackpack(soundId=173){
    const body=this.modal(this.text.backpack,soundId,'backpack');
    body.classList.add('backpack-body');
    const progress=this.callbacks.getProgress()||{};
    const collected=new Set((progress.dossiers||[]).map(Number));
    const dossiers=await this.loadDossiers();
    if(this.find('.menu-modal').hidden)return; // closed while loading
    body.replaceChildren();
    const head=document.createElement('div');head.className='backpack-head';
    const count=document.createElement('span');count.className='backpack-count';
    count.textContent=`${this.text.collected} ${collected.size} / ${dossiers.length||17}`;
    head.appendChild(count);body.appendChild(head);
    const grid=document.createElement('div');grid.className='backpack-grid';
    for(const entry of dossiers){
      const unlocked=collected.has(Number(entry.tag));
      const card=document.createElement('button');card.type='button';
      card.className=`dossier-card ${unlocked?'unlocked':'locked'}`;
      card.style.backgroundImage=`url("assets/ui/dossiers/dossier_${entry.id}${unlocked?'':'_locked'}.png")`;
      const title=unlocked?(((entry.title||{})[this.settings.language])||(entry.title||{}).en||entry.id):this.text.dossierUnknown;
      card.title=title;card.setAttribute('aria-label',title);
      if(unlocked)card.addEventListener('click',()=>this.showDossier(entry));
      else card.setAttribute('aria-disabled','true');
      grid.appendChild(card);
    }
    body.appendChild(grid);
    const hint=document.createElement('p');hint.className='backpack-hint';hint.textContent=this.text.dossierHint;
    body.appendChild(hint);
  }
  showDossier(entry){
    const body=this.find('.modal-body');
    if(!body)return;
    this.dossierOpen=true;
    audio.playSound(173,{priority:6}); // ui_woosh_dossier: open a dossier
    const lang=this.settings.language;
    const titleText=((entry.title||{})[lang])||(entry.title||{}).en||entry.id;
    const summaryText=((entry.summary||{})[lang])||(entry.summary||{}).en||'';
    const modalEl=this.find('.menu-modal');
    modalEl.classList.remove('backpack-mode');
    modalEl.classList.add('dossier-mode');
    const heading=this.find('.options-card h1');
    if(heading)heading.textContent=titleText;   // the paper sheet carries its own title
    body.classList.remove('backpack-body');body.classList.add('dossier-body');
    body.replaceChildren();
    const view=document.createElement('div');view.className='dossier-view';
    const portrait=document.createElement('img');portrait.className='dossier-portrait';portrait.src=`assets/ui/dossiers/portrait_${entry.id}.png`;portrait.alt='';
    const shot=document.createElement('img');shot.className='dossier-shot';shot.src=`assets/ui/dossiers/screenshot_${entry.id}.png`;shot.alt='';
    shot.addEventListener('error',()=>{shot.hidden=true;});
    const summary=document.createElement('p');summary.className='dossier-summary';summary.textContent=summaryText;
    const back=document.createElement('button');back.type='button';back.className='menu-long dossier-back';back.textContent=this.text.dossierBack;
    back.addEventListener('click',()=>this.showBackpack(175)); // ui_woosh_quick: close detail
    view.append(portrait,summary,shot,back);
    body.appendChild(view);
    // The clicked card was replaced, so move focus back inside the menu root:
    // the Escape handler is bound on #frontEnd and needs a focused descendant.
    if(typeof back.focus==='function')back.focus();
  }
  showCatalog(){
    const body=this.modal(this.text.bag);body.classList.add('catalog-body');
    this.levels.forEach((level,index)=>this.button(body,`${level.num||level.id} ${resultsModel(level).title}`,()=>this.play(index)));
  }
}
