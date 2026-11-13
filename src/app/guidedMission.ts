import { BASES } from '../data/bases';
import type { Lang } from '../data/bodies';
import type { Intent } from '../intents';
import type { HandObs } from '../gestures/perception';
import { steerFromPalm } from '../gestures/steer';
import { GuidedSession, HoldConfirm } from './guidedSession';
import './guidedMission.css';

const words = {
  en: {title:'Guided mission · prototype',start:'Start 5-minute experience',review:'Passenger: Guest · Ready to travel?',destination:'Choose destination before launch',outbound:'Flight · Finish landing safely',exploring:'Explore · Return when ready',return:'Time is up · Return to Earth',returning:'Returning to Earth',complete:'Experience complete',confirm:'👍 Confirm',back:'👍 Return to Earth',hold:'Hold 👍 to confirm · Release before repeating',landing:'✋ Move · Hold ✊ for auto-land',waiting:'Continue the saved journey first',idle:'Five-minute guided experience · Camera optional'},
  ja: {title:'ガイドミッション · 試作',start:'5分間の体験を開始',review:'搭乗者：ゲスト · 準備はよいですか？',destination:'発進前に目的地を選択',outbound:'飛行中 · 安全に着陸してください',exploring:'探索中 · 準備ができたら帰還',return:'時間終了 · 地球へ帰還',returning:'地球へ帰還中',complete:'体験終了',confirm:'👍 確認',back:'👍 地球へ帰還',hold:'👍 をキープして確認 · 次の操作前に手を戻す',landing:'✋ 移動 · ✊ キープで自動着陸',waiting:'保存した旅を先に続けてください',idle:'5分間のガイド体験 · カメラなしでも操作可能'},
  my: {title:'လမ်းညွှန်ခရီး · စမ်းသပ်ပုံစံ',start:'၅ မိနစ်ခရီး စတင်ရန်',review:'ခရီးသည် — ဧည့်သည်။ အဆင်သင့်ဖြစ်ပါသလား။',destination:'မထွက်ခွာမီ သွားမည့်နေရာရွေးပါ',outbound:'ခရီးသွားနေသည် · ဘေးကင်းစွာ ဆင်းသက်ပါ',exploring:'လေ့လာပါ · အဆင်သင့်ဖြစ်လျှင် ပြန်ပါ',return:'အချိန်ပြည့်ပြီ · ကမ္ဘာသို့ ပြန်ပါ',returning:'ကမ္ဘာသို့ ပြန်နေသည်',complete:'ခရီးပြီးဆုံးပါပြီ',confirm:'👍 အတည်ပြုရန်',back:'👍 ကမ္ဘာသို့ ပြန်ရန်',hold:'👍 ကို ခဏငြိမ်ထားပါ · နောက်တစ်ကြိမ်မလုပ်မီ လက်ပြန်လျှော့ပါ',landing:'✋ ရွှေ့ရန် · ✊ ဆုပ်ထားလျှင် အလိုအလျောက်ဆင်းမည်',waiting:'သိမ်းထားသော ခရီးကို ဦးစွာဆက်ပါ',idle:'၅ မိနစ် လမ်းညွှန်ခရီး · ကင်မရာမရှိလည်း အသုံးပြုနိုင်သည်'},
};
const detailWords = {
  en: {step:'Step',next:'Next visitor · Start',seen:'Hand detected',show:'Show 👍 to confirm, or tap the button',holding:'Keep holding…',confirmed:'✓ Confirmed',release:'Release your hand before the next action',land:'✋ Move · Hold ✊ to auto-land, or use Auto-land',touch:'Touch controls are available',cancel:'Cancel countdown',countdown:'Launching after 3–2–1',flight:'Flight in progress',returnFlight:'Returning · Finish landing safely',visited:'Visited',none:'No destination visited',duration:'Experience duration',unknown:'Not recorded',minute:'1 minute left · Return when ready',ready:'Choose a destination, then confirm',timer:'Time remaining'},
  ja: {step:'ステップ',next:'次の方 · 開始',seen:'手を検出しました',show:'👍 を見せて確認、またはボタンをタップ',holding:'そのままキープ…',confirmed:'✓ 確認しました',release:'次の操作前に手を戻してください',land:'✋ 移動 · ✊ キープ、または自動着陸ボタン',touch:'タッチでも操作できます',cancel:'カウントダウン中止',countdown:'3・2・1で発進',flight:'飛行中',returnFlight:'帰還中 · 安全に着陸してください',visited:'訪問先',none:'訪問先なし',duration:'体験時間',unknown:'記録なし',minute:'残り1分 · 準備ができたら帰還',ready:'目的地を選んで確認してください',timer:'残り時間'},
  my: {step:'အဆင့်',next:'နောက်ဧည့်သည် · စတင်ရန်',seen:'လက်ကို တွေ့ရှိပြီ',show:'👍 ပြပြီး အတည်ပြုပါ၊ သို့မဟုတ် ခလုတ်နှိပ်ပါ',holding:'ခဏငြိမ်ထားပါ…',confirmed:'✓ အတည်ပြုပြီးပါပြီ',release:'နောက်တစ်ကြိမ်မလုပ်မီ လက်ပြန်လျှော့ပါ',land:'✋ ရွှေ့ပါ · ✊ ဆုပ်ထားပါ၊ သို့မဟုတ် Auto-land နှိပ်ပါ',touch:'ခလုတ်နှိပ်၍လည်း သုံးနိုင်သည်',cancel:'ရေတွက်မှု ရပ်ရန်',countdown:'၃၊ ၂၊ ၁ ပြီးလျှင် ထွက်ခွာမည်',flight:'ခရီးသွားနေပါသည်',returnFlight:'ပြန်ခရီး · ဘေးကင်းစွာ ဆင်းသက်ပါ',visited:'ရောက်ခဲ့သည့်နေရာ',none:'မည်သည့်နေရာသို့မှ မရောက်သေးပါ',duration:'အတွေ့အကြုံ ကြာချိန်',unknown:'မှတ်တမ်းမရှိပါ',minute:'၁ မိနစ်ကျန်ပြီ · အဆင်သင့်ဖြစ်လျှင် ပြန်ပါ',ready:'နေရာရွေးပြီး အတည်ပြုပါ',timer:'ကျန်ရှိချိန်'},
};
interface View { mode:string; base:string|null; lang:Lang; blocked:boolean; sensitivity:Parameters<typeof steerFromPalm>[1] }

/** Flag-owned UI adapter. All scene mutations remain native Mission intents. */
export class GuidedMission {
  readonly session = new GuidedSession();
  private readonly root=document.createElement('section');
  private readonly label=document.createElement('strong');
  private readonly timer=document.createElement('span');
  private readonly instruction=document.createElement('span');
  private readonly step=document.createElement('span');
  private readonly feedback=document.createElement('span');
  private readonly summary=document.createElement('dl');
  private readonly destinations=document.createElement('div');
  private readonly action=document.createElement('button');
  private readonly progress=document.createElement('progress');
  private readonly hold=new HoldConfirm();
  private own=false;
  private observedAt=-Infinity;
  private handSeen=false;
  private confirmedUntil=0;
  private key='';
  private saved='';
  private restored=true;
  private readonly storageKey='gse.guided.v1';
  constructor(private readonly emit:(intent:Intent)=>void, private readonly view:()=>View) {
    try { this.session.restore(sessionStorage.getItem(this.storageKey),BASES.map(b=>b.id),Date.now()); } catch { /* optional storage */ }
    document.body.classList.add('guided-mode');
    this.root.id='guided-mission'; this.root.setAttribute('aria-label','Guided mission');
    this.feedback.className='guided-feedback';this.feedback.setAttribute('role','status');
    this.feedback.setAttribute('aria-live','polite');
    this.timer.className='guided-time';this.timer.setAttribute('role','timer');
    this.step.className='guided-step';this.instruction.className='guided-instruction';
    this.summary.className='guided-summary';
    this.progress.max=1; this.progress.setAttribute('aria-label','Gesture hold');
    this.action.type='button'; this.action.addEventListener('click',()=>this.confirm());
    this.root.append(this.label,this.step,this.timer,this.instruction,this.destinations,this.summary,this.action,this.progress,this.feedback);
    document.querySelector('header.hud')!.append(this.root);
  }
  /** The camera stopped: no hand is seen any more, and a hold it cut off must be made again from the start. */
  cameraStopped() {
    this.hold.interrupt(); this.handSeen=false; this.progress.value=0;
  }
  /**
   * Forgets a restored journey that no native mission continues (Start fresh, or no checkpoint to offer).
   * main.ts calls it before a deep link applies, so the stale session can't swallow the link's intents.
   */
  discard() {
    this.session.reset(); this.hold.reset(); this.restored=false; this.confirmedUntil=0; this.key='';
    this.saved=this.session.snapshot();
    try { sessionStorage.setItem(this.storageKey,this.saved); } catch { /* optional storage */ }
  }
  private send(intent:Intent) { this.own=true; try { this.emit(intent); } finally { this.own=false; } }
  private confirm() {
    const v=this.view(); if(v.blocked)return;
    if(v.mode==='launch') {
      this.session.stage=this.session.stage==='returning'?'return':'destination';
      this.send({type:'dismiss'});this.hold.reset();this.key='';return;
    }
    if(!this.session.active) {
      if(!['solarView','focus','baseView'].includes(v.mode))return;
      if(!v.base)this.send({type:'enterBase',baseId:'cape'});
      if(this.view().mode!=='baseView')return;
      this.session.start(Date.now());this.hold.reset();this.confirmedUntil=0;
    } else {
      if(v.mode!=='baseView')return;
      const before=this.session.stage;
      const target=this.session.confirm(v.base!,Date.now());
      if(this.session.stage!==before) {this.confirmedUntil=performance.now()+800;this.hold.requireRelease();}
      if(target) { this.send({type:'chooseDestination',baseId:target}); this.send({type:'launch'}); }
    }
    this.key='';
  }
  intercept(intent:Intent) {
    if(this.own || !this.session.active)return false;
    if(intent.type==='dismiss') {
      if(this.view().blocked)return false;
      if(this.view().mode==='launch') {
        this.session.stage=this.session.stage==='returning'?'return':'destination';
        return false;
      }
    }
    if(intent.type==='select') {
      if(['travel','docking'].includes(this.view().mode))return false;
      if(!intent.bodyId)this.confirm();
      return true;
    }
    return ['next','prev','nextMoon','chooseDestination','enterBase','launch','countdown','dismiss','toggleBuild','timeScale','timeDial','setTimeSpeed','reverseTime','timeNow','timeJump'].includes(intent.type);
  }
  observe(t:number, obs:HandObs|null) {
    if(!this.session.active) { this.hold.update(t,false); return; }
    const v=this.view();
    this.observedAt=performance.now();this.handSeen=!!obs;
    const eligible=!v.blocked && (v.mode==='docking' || (v.mode==='baseView' && ['review','destination','exploring','return'].includes(this.session.stage)));
    const present=eligible && (v.mode==='docking' ? obs?.pose==='fist' && !obs.thumbsUp : !!obs?.thumbsUp);
    if(this.hold.update(t,present)) {
      if(v.mode==='docking') {this.send({type:'select'});this.confirmedUntil=performance.now()+800;} else this.confirm();
    }
    this.progress.value=this.hold.progress;
    if(v.blocked)return;
    if(v.mode==='docking' && obs?.pose==='palm')this.send({type:'steer',...steerFromPalm(obs.center,v.sensitivity)});
    if(this.session.stage==='destination' && obs?.pose==='palm') {
      // The hand's horizontal position points at a destination; 👍 confirms separately.
      const options=BASES.filter(b=>b.id!==v.base);
      const selected=options[Math.min(options.length-1,Math.floor(Math.max(0,Math.min(.999,obs.center.x))*options.length))];
      if(selected)this.session.choose(selected.id);
    }
  }
  render() {
    const v=this.view(), s=this.session, w=words[v.lang],d=detailWords[v.lang];
    if(!v.blocked) {
      // A refresh during countdown has no in-flight checkpoint: ask again rather than auto-launch.
      if(this.restored && v.mode==='baseView') {
        if(s.stage==='outbound' && v.base!==s.destination)s.stage='destination';
        if(s.stage==='returning' && v.base!=='cape')s.stage='return';
      }
      this.restored=false;
      const before=s.stage;
      s.update(v.mode,v.base,Date.now());
      // An arrival is a new step: a 👍 still held from before it must be released before it confirms anything.
      if(s.stage!==before)this.hold.requireRelease();
    }
    const snapshot=s.snapshot();
    if(snapshot!==this.saved) { this.saved=snapshot;try { sessionStorage.setItem(this.storageKey,snapshot); } catch { /* private mode */ } }
    const seconds=s.active?s.remaining(Date.now()):300;
    const time=s.active?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'';
    if(this.timer.textContent!==time)this.timer.textContent=time;
    const eligible=s.active && !v.blocked && (v.mode==='docking'||v.mode==='baseView'&&['review','destination','exploring','return'].includes(s.stage));
    const detected=this.handSeen && performance.now()-this.observedAt<1000;
    const state=!eligible?'touch':performance.now()<this.confirmedUntil?'confirmed':this.hold.waitingRelease && detected?'release':detected && this.hold.progress>0 && !this.hold.waitingRelease?'holding':detected?'seen':'show';
    const feedback=v.mode==='docking'&&state==='show'?d.touch:d[state];
    if(this.feedback.textContent!==feedback)this.feedback.textContent=feedback;
    this.feedback.dataset.state=state;
    this.feedback.hidden=!eligible;
    this.progress.hidden=!eligible || !detected;
    const urgent=s.active&&seconds<=60;
    this.root.dataset.urgency=urgent?'low':'normal';
    this.root.dataset.stage=s.stage;
    document.body.classList.toggle('guided-active',s.active);
    const key=[urgent,v.lang,v.mode,v.base,v.blocked,s.stage,s.destination,s.expired].join('|');
    if(key===this.key)return; this.key=key;
    this.label.textContent=w.title;
    const number=s.stage==='complete'?7 : ['return','returning'].includes(s.stage)?6 : s.stage==='exploring'||v.mode==='docking'?5 : s.stage==='outbound'?(v.mode==='launch'?3:4):s.stage==='destination'?2:1;
    this.step.textContent=s.stage==='idle'?'':`${d.step} ${number} / 7`;
    this.timer.setAttribute('aria-label',d.timer);
    this.progress.setAttribute('aria-label',d.holding);
    const prompt=v.mode==='launch'?d.countdown : v.mode==='docking'?d.land : v.mode==='travel'?(s.stage==='returning'?d.returnFlight:d.flight) : s.stage==='destination'?d.ready : s.stage==='exploring'&&urgent?d.minute:w[s.stage];
    this.instruction.textContent=v.blocked?w.waiting:prompt;
    this.summary.replaceChildren();this.summary.hidden=s.stage!=='complete';
    if(s.stage==='complete') {
      for(const [label,value] of [[d.visited,s.visited.map(id=>BASES.find(b=>b.id===id)!.name[v.lang]).join(' · ')||d.none],[d.duration,s.completedAt===null?d.unknown:`${Math.floor(s.elapsed(Date.now())/60)}:${String(s.elapsed(Date.now())%60).padStart(2,'0')}`]]) {
        const term=document.createElement('dt'),desc=document.createElement('dd');term.textContent=label;desc.textContent=value;this.summary.append(term,desc);
      }
    }

    this.destinations.replaceChildren();
    this.destinations.hidden=s.stage!=='destination';
    if(s.stage==='destination')for(const b of BASES.filter(b=>b.id!==v.base)) {
      const button=document.createElement('button'); button.type='button'; button.textContent=b.name[v.lang];
      button.setAttribute('aria-pressed',String(s.destination===b.id));
      button.addEventListener('click',()=>{s.choose(b.id);this.key='';}); this.destinations.append(button);
    }
    this.action.textContent=v.mode==='launch'?d.cancel:s.stage==='complete'?d.next:!s.active?w.start : ['exploring','return'].includes(s.stage)?w.back:w.confirm;
    this.action.hidden=s.active && v.mode!=='launch' && !['review','destination','exploring','return'].includes(s.stage);
    this.action.disabled=v.blocked || (s.active?!['baseView','launch'].includes(v.mode)||s.stage==='destination'&&!s.destination:!['solarView','focus','baseView'].includes(v.mode));

  }
  dispose() { this.root.remove(); document.body.classList.remove('guided-mode','guided-active'); }
}
