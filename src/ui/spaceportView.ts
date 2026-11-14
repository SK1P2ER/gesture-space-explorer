import type { Lang } from '../data/bodies';
import type { SpaceportPreview, SpaceportCamera } from '../scene/spaceportPreview';
import type { LandmarkId } from '../scene/spaceportCollision';
import './spaceportView.css';

const TEXT = {
  enter: { en: 'Explore spaceport · 3D', my: 'စခန်းကို အနီးကပ်ကြည့်ရန် · 3D', ja: '宇宙港を探索 · 3D' },
  title: { en: 'Tanegashima · Coastal spaceport', my: 'တနီဂါရှီမာ · ကမ်းရိုးတန်း အာကာသစခန်း', ja: '種子島 · 海辺の宇宙港' },
  close: { en: 'Back to mission', my: 'မစ်ရှင်သို့ ပြန်ရန်', ja: 'ミッションに戻る' },
  cancel: { en: 'Cancel launch', my: 'လွှတ်တင်မှု ပယ်ဖျက်ရန်', ja: '打ち上げを中止' },
  skip: { en: 'Skip launch', my: 'လွှတ်တင်မှု ကျော်ရန်', ja: '打ち上げをスキップ' },
  departure: { en: 'Launching to', my: 'ပျံသန်းမည့်နေရာ', ja: '目的地' },
  resume: { en: 'Resume launch', my: 'လွှတ်တင်မှု ဆက်ကြည့်ရန်', ja: '打ち上げを再開' },
  missionHint: { en: 'Your selected flight continues after liftoff. Skip to depart now, or cancel to stay at the spaceport.', my: 'လွှတ်တင်မှုအပြီး ရွေးထားသောနေရာသို့ ဆက်ပျံသန်းပါမည်။ ချက်ချင်းသွားရန် ကျော်နိုင်ပြီး စခန်းမှာနေရန် ပယ်ဖျက်နိုင်ပါသည်။', ja: '離昇後は選択した目的地へのフライトに進みます。スキップですぐに出発、中止で宇宙港に戻ります。' },
  overview: { en: 'Coastal overview', my: 'စခန်းတစ်ခုလုံး', ja: '海岸の全景' },
  garden: { en: 'Building gardens', my: 'အဆောက်အအုံနှင့် ဥယျာဉ်', ja: '建物と庭園' },
  launch: { en: 'Launch pad', my: 'လွှတ်တင်စင်', ja: '発射台' },
  play: { en: 'Play launch · 20s', my: 'လွှတ်တင်မှု ကြည့်ရန် · ၂၀ စက္ကန့်', ja: '打ち上げを再生 · 20秒' },
  pause: { en: 'Pause', my: 'ခေတ္တရပ်ရန်', ja: '一時停止' },
  replay: { en: 'Replay launch', my: 'လွှတ်တင်မှု ပြန်ကြည့်ရန်', ja: 'もう一度再生' },
  timeline: { en: 'Launch timeline', my: 'လွှတ်တင်မှု အချိန်', ja: '打ち上げの時間' },
  loading: { en: 'Loading spaceport…', my: 'စခန်းကို ဖွင့်နေပါသည်…', ja: '宇宙港を読み込み中…' },
  failed: { en: 'Could not load the 3D scene. Try again.', my: '3D မြင်ကွင်း ဖွင့်မရပါ။ ပြန်စမ်းပါ။', ja: '3Dシーンを読み込めませんでした。再試行してください。' },
  retry: { en: 'Try again', my: 'ပြန်စမ်းရန်', ja: '再試行' },
  hint: { en: 'Drag to orbit · scroll or pinch to zoom. This launch preview keeps your mission in place.', my: 'ဆွဲ၍ လှည့်ကြည့်ပါ · scroll သို့မဟုတ် လက်နှစ်ချောင်းဖြင့် ချုံ့ချဲ့ပါ။ မစ်ရှင်ကို ခေတ္တရပ်ထားပါသည်။', ja: 'ドラッグで回転・スクロールやピンチで拡大縮小。プレビュー中はミッションを保持します。' },
  parked: {en:'Parked launch vehicle · your active vehicle remains in the mission view.',my:'လွှတ်တင်ရန် ရပ်ထားသောယာဉ် · သင့်ယာဉ်ကို မစ်ရှင်မြင်ကွင်းတွင် ကြည့်နိုင်ပါသည်။',ja:'発射待機中の機体・操作中の機体はミッション画面にあります。'},
  ready: { en: 'Ready', my: 'အသင့်', ja: '準備完了' },
  arms: { en: 'Service arms retracting', my: 'Service arms ပြန်ခေါက်နေပါသည်', ja: 'サービスアーム退避' },
  ignition: { en: 'Engine ignition', my: 'အင်ဂျင် စက်နှိုးနေပါသည်', ja: 'エンジン点火' },
  ascent: { en: 'Liftoff & ascent', my: 'ပျံတက်နေပါသည်', ja: '離昇・上昇' },
  reset: { en: 'Reset view', my: 'မြင်ကွင်း ပြန်ချိန်ရန်', ja: '視点をリセット' },
  assembly: { en: 'Assembly building', my: 'ယာဉ်တပ်ဆင်ရေး အဆောက်အအုံ', ja: '機体組立棟' },
  control: { en: 'Control center', my: 'ထိန်းချုပ်ရေး စခန်း', ja: '管制センター' },
  pad: { en: 'Launch complex', my: 'လွှတ်တင်ရေး နေရာ', ja: '発射施設' },
  landing: { en: 'Landing zone', my: 'ဆင်းသက်ရေး နေရာ', ja: '着陸エリア' },
  assemblyInfo: { en: 'The high bay houses vehicle assembly. The rollout road connects it to the launch apron.', my: 'ဤနေရာတွင် ယာဉ်တပ်ဆင်ပြီး လမ်းမကြီးအတိုင်း လွှတ်တင်စင်သို့ ရွှေ့နိုင်ပါသည်။', ja: '大型の機体を組み立て、搬出路で発射台へ移動させます。' },
  controlInfo: { en: 'Flight control overlooks the service roads. Eight trees and small garden beds frame the buildings.', my: 'ပျံသန်းမှု ထိန်းချုပ်ရေးနှင့် ဝန်ဆောင်မှုလမ်းများကို ကြည့်ရှုရာနေရာဖြစ်သည်။ အဆောက်အအုံများနားတွင် သစ်ပင်နှင့် ဥယျာဉ်အနည်းငယ် ရှိပါသည်။', ja: '運用道路を見渡す管制棟。建物の周囲に8本の樹木と小さな庭園があります。' },
  padInfo: { en: 'The gantry services the Shuttle before launch. Its two arms retract before engine ignition.', my: 'Gantry မှ Shuttle ကို လွှတ်တင်ရန် ပြင်ဆင်ပေးပြီး အင်ဂျင်မနှိုးမီ service arms နှစ်ချောင်းကို ပြန်ခေါက်ပါသည်။', ja: 'ガントリーで機体を準備し、点火前に2本のサービスアームを退避させます。' },
  landingInfo: { en: 'A separate 32-metre-radius landing zone stays clear of buildings and landscaping.', my: 'အချင်းဝက် ၃၂ မီတာရှိသော ဆင်းသက်ရေးနေရာကို အဆောက်အအုံနှင့် သစ်ပင်များ ကင်းရှင်းစွာ ထားရှိပါသည်။', ja: '半径32mの専用着陸エリア。建物や植栽を配置せず安全な空間を確保します。' },
  performance: { en: 'Performance', my: 'စွမ်းဆောင်ရည်', ja: 'パフォーマンス' },
  saveReport: { en: 'Save performance report', my: 'စွမ်းဆောင်ရည် အစီရင်ခံစာ သိမ်းရန်', ja: '計測レポートを保存' },
} as const satisfies Record<string, Record<Lang, string>>;

/** Lightweight entry point. Three.js loaders and the authored model load only after opening. */
export class SpaceportView {
  private readonly dialog = document.createElement('dialog');
  private readonly stage = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly controls = document.createElement('div');
  private readonly play = document.createElement('button');
  private readonly timeline = document.createElement('input');
  private readonly phase = document.createElement('span');
  private readonly retry = document.createElement('button');
  private readonly skip = document.createElement('button');
  private readonly inspection = document.createElement('section');
  private readonly report = document.createElement('output');
  private lastReport = 0;
  private readonly views = new Map<SpaceportCamera, HTMLButtonElement>();
  private viewer: SpaceportPreview | null = null;
  private abort: AbortController | null = null;
  private lang: Lang = 'en';
  private low = true;
  private reduced = false;
  private lastPhase = '';
  private lastPlaying: boolean | null = null;
  private lastView = '';
  private launch: { complete: () => void; cancel: () => void } | null = null;
  private launchTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.dialog.id = 'spaceport-view';
    this.dialog.setAttribute('aria-labelledby', 'spaceport-title');
    this.dialog.dataset.sceneShortcuts = 'off';
    const header = document.createElement('div'); header.className = 'spaceport-heading';
    const title = document.createElement('h2'); title.id = 'spaceport-title';
    const close = document.createElement('button'); close.type = 'button'; close.dataset.label = 'close';
    close.addEventListener('click', () => this.close());
    this.skip.type = 'button'; this.skip.id = 'spaceport-skip-launch'; this.skip.hidden = true;
    this.skip.addEventListener('click', () => this.finishLaunch(true));
    header.append(title, this.skip, close);
    this.stage.className = 'spaceport-stage';
    this.stage.setAttribute('aria-label', '3D spaceport');
    this.status.className = 'spaceport-status';
    this.status.setAttribute('role', 'status');
    this.retry.type = 'button'; this.retry.dataset.label = 'retry'; this.retry.hidden = true;
    this.retry.addEventListener('click', () => { void this.load(); });
    this.controls.className = 'spaceport-controls';
    const cameras = document.createElement('div'); cameras.className = 'spaceport-cameras';
    for (const view of ['overview', 'garden', 'launch'] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.label = view;
      button.addEventListener('click', () => { this.clearInspection(); this.viewer?.setView(view); this.timeline.max = String(479/24); });
      cameras.append(button); this.views.set(view, button);
    }
    const reset = document.createElement('button'); reset.type = 'button'; reset.id = 'spaceport-reset'; reset.dataset.label = 'reset';
    reset.addEventListener('click',()=>{ this.viewer?.resetView(this.reduced); this.timeline.max = String(479/24); this.clearInspection(); });
    cameras.append(reset);
    const landmarks = document.createElement('div'); landmarks.className = 'spaceport-landmarks';
    for (const id of ['assembly','control','pad','landing'] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.label = id; button.dataset.landmark = id;
      button.addEventListener('click',()=>this.inspect(id)); landmarks.append(button);
    }
    this.inspection.id = 'spaceport-inspection'; this.inspection.hidden = true; this.inspection.setAttribute('aria-live','polite');
    this.play.type = 'button'; this.play.id = 'spaceport-play';
    this.play.addEventListener('click', () => {
      if (!this.viewer) return;
      if (this.viewer.playing) this.viewer.playing = false;
      else { this.clearInspection(); this.viewer.play(); }
    });
    this.timeline.type = 'range'; this.timeline.min = '0'; this.timeline.max = String(479 / 24); this.timeline.step = '0.01'; this.timeline.value = '0';
    this.timeline.id = 'spaceport-timeline';
    this.timeline.addEventListener('input', () => {
      if (!this.viewer) return;
      this.viewer.playing = false;
      this.viewer.seek(Number(this.timeline.value));
    });
    this.phase.className = 'spaceport-phase'; this.phase.setAttribute('role', 'status');
    const transport = document.createElement('div'); transport.className = 'spaceport-transport';
    transport.append(this.play, this.timeline, this.phase);
    const hint = document.createElement('p'); hint.className = 'spaceport-hint'; hint.dataset.label = 'hint';
    const parked=document.createElement('p');parked.className='spaceport-parked spaceport-hint';parked.dataset.label='parked';
    const credits = document.createElement('p'); credits.className = 'spaceport-credits';
    const link = document.createElement('a'); link.textContent = 'Quaternius · CC0'; link.href = 'https://quaternius.itch.io/stylized-nature-megakit'; link.target = '_blank'; link.rel = 'noopener';
    credits.append('ASTROLIFE M03 · ', link);
    const performance = document.createElement('details'); performance.className = 'spaceport-performance';
    const summary = document.createElement('summary'); summary.dataset.label = 'performance';
    const save = document.createElement('button'); save.type = 'button'; save.dataset.label = 'saveReport';
    save.addEventListener('click',()=>{
      if (!this.viewer) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(this.viewer.performanceReport(),null,2)],{type:'application/json'}));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'spaceport-performance.json'; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    performance.append(summary,this.report,save);
    this.controls.append(cameras,landmarks,this.inspection,transport,hint,parked,performance,credits);
    this.dialog.append(header, this.stage, this.status, this.retry, this.controls);
    this.dialog.addEventListener('close', () => {
      if (this.dialog.open) return; // Ignore a queued close event from a preceding presentation.
      if (this.launch) this.finishLaunch(false);
      else this.release();
    });
    this.dialog.addEventListener('cancel', event => {
      if (this.launch) { event.preventDefault(); this.finishLaunch(false); }
      else this.release();
    });
    document.body.append(this.dialog);
  }

  get active() { return this.dialog.open; }
  get preview() { return this.viewer; }
  get missionLaunch() { return this.launch !== null; }

  render(lang: Lang, low: boolean, reducedMotion: boolean) {
    this.lang = lang; this.low = low; this.reduced = reducedMotion;
  }

  private prepare(destination?: string) {
    this.timeline.max = String(479/24); this.clearInspection();
    this.dialog.dataset.purpose = destination ? 'mission' : 'preview';
    this.dialog.querySelector('h2')!.textContent = destination ? `${TEXT.departure[this.lang]} · ${destination}` : TEXT.title[this.lang];
    for (const element of this.dialog.querySelectorAll<HTMLElement>('[data-label]')) element.textContent = TEXT[element.dataset.label as keyof typeof TEXT][this.lang];
    this.dialog.querySelector<HTMLElement>('[data-label="close"]')!.textContent = TEXT[destination ? 'cancel' : 'close'][this.lang];
    this.dialog.querySelector<HTMLElement>('[data-label="hint"]')!.textContent = TEXT[destination ? 'missionHint' : 'hint'][this.lang];
    this.skip.textContent = TEXT.skip[this.lang]; this.skip.hidden = !destination;
    this.timeline.setAttribute('aria-label', TEXT.timeline[this.lang]);
    this.dialog.showModal();
  }

  async open() {
    if (this.active) return;
    this.prepare();
    await this.load();
  }

  /** Hold the real mission's launch boundary until the authored animation ends or is skipped. */
  startLaunch(destination: string, complete: () => void, cancel: () => void): () => void {
    this.close();
    const launch = this.launch = { complete, cancel };
    this.prepare(destination);
    // A slow/blocked asset must not strand the selected mission. Skip is usable while loading.
    void this.load();
    return () => {
      if (this.launch !== launch) return;
      this.launch = null;
      this.dismiss();
    };
  }

  private inspect(id: LandmarkId) {
    this.viewer?.inspect(id,this.reduced);
    this.timeline.max = String(479/24);
    const heading = document.createElement('h3'); heading.textContent = TEXT[id][this.lang];
    const description = document.createElement('p'); description.textContent = TEXT[`${id}Info`][this.lang];
    this.inspection.replaceChildren(heading,description); this.inspection.hidden = false;
    for (const button of this.controls.querySelectorAll<HTMLButtonElement>('[data-landmark]')) button.setAttribute('aria-pressed',String(button.dataset.landmark===id));
  }

  private clearInspection() {
    this.inspection.hidden = true;
    for (const button of this.controls.querySelectorAll('[data-landmark]')) button.setAttribute('aria-pressed','false');
  }

  private async load() {
    this.release();
    const request = this.abort = new AbortController();
    const launch = this.launch;
    if (launch) this.launchTimeout = setTimeout(() => { if (this.launch === launch) this.finishLaunch(true); }, 20000);
    this.status.hidden = false;
    this.status.textContent = TEXT.loading[this.lang];
    this.retry.hidden = true;
    for (const button of this.controls.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')) button.disabled = true;
    try {
      const { SpaceportPreview } = await import('../scene/spaceportPreview');
      if (request.signal.aborted || !this.active) return;
      this.viewer = new SpaceportPreview(this.stage, this.low, id=>this.inspect(id));
      await this.viewer.load(request.signal);
      if (request.signal.aborted || !this.active) return;
      if (this.launch) {
        this.viewer.controls.enabled = false;
        this.viewer.play();
        if (request.signal.aborted || !this.active) return;
      }
      this.status.hidden = true;
      for (const button of this.controls.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')) button.disabled = false;
      if (this.launch) this.timeline.disabled = true;
      this.clearLaunchTimeout();
    } catch (error) {
      if (request.signal.aborted || !this.active) return;
      this.viewer?.dispose(); this.viewer = null;
      if (this.launch) {
        console.warn('Spaceport launch presentation unavailable; continuing flight', error);
        this.finishLaunch(true);
        return;
      }
      this.status.textContent = TEXT.failed[this.lang];
      this.retry.hidden = false;
      console.warn('Spaceport preview unavailable', error);
    }
  }

  update(dt: number, reducedMotion = this.reduced) {
    this.reduced = reducedMotion;
    if (this.launch && reducedMotion) { this.finishLaunch(true); return; }
    if (!this.active || !this.viewer) return;
    this.viewer.update(dt, this.reduced);
    if (this.launch !== null && this.viewer.time >= 479/24) { this.finishLaunch(true); return; }
    this.timeline.value = String(this.viewer.time);
    const time = this.viewer.time;
    const phase = time < 3 ? 'ready' : time < 6 ? 'arms' : time < 9 ? 'ignition' : 'ascent';
    if (phase !== this.lastPhase) { this.phase.textContent = TEXT[phase][this.lang]; this.lastPhase = phase; }
    const playing = this.viewer.playing;
    const label = playing ? 'pause' : this.launch ? 'resume' : time >= 479 / 24 - 0.01 ? 'replay' : 'play';
    if (playing !== this.lastPlaying || this.play.dataset.state !== label) {
      this.play.textContent = TEXT[label][this.lang]; this.play.dataset.state = label; this.lastPlaying = playing;
    }
    if (this.viewer.view !== this.lastView) {
      for (const [view, button] of this.views) button.setAttribute('aria-pressed', String(view === this.viewer.view));
      this.lastView = this.viewer.view;
    }
    if (performance.now()-this.lastReport > 500) {
      this.lastReport = performance.now(); const report = this.viewer.performanceReport();
      this.report.textContent = `${report.fps.toFixed(0)} FPS · p95 ${report.frameP95Ms.toFixed(1)} ms · ${report.drawCalls} calls · ~${(report.estimatedGpuBytes/1048576).toFixed(1)} MiB geometry/textures`;
    }
  }

  private finishLaunch(continueFlight: boolean) {
    const launch = this.launch;
    if (!launch) return;
    this.launch = null;
    this.dismiss();
    if (continueFlight) launch.complete();
    else launch.cancel();
  }
  close() {
    if (this.launch) this.finishLaunch(false);
    else this.dismiss();
  }
  private dismiss() { if (this.active) this.dialog.close(); this.release(); }
  private clearLaunchTimeout() {
    if (this.launchTimeout !== null) clearTimeout(this.launchTimeout);
    this.launchTimeout = null;
  }
  private release() {
    this.clearLaunchTimeout();
    this.abort?.abort(); this.abort = null;
    this.viewer?.dispose(); this.viewer = null;
    this.lastPhase = this.lastView = ''; this.lastPlaying = null;
  }
  dispose() { this.close(); this.dialog.remove(); }
}
