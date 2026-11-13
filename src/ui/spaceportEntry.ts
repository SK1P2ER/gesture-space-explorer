import type { Lang } from '../data/bodies';
import type { SpaceportView } from './spaceportView';

const LABEL = { en:'Launch preview · 3D', my:'လွှတ်တင်မှု ကြည့်ရန် · 3D', ja:'打ち上げプレビュー · 3D' };
const LOADING = { en:'Opening spaceport…', my:'စခန်းကို ဖွင့်နေပါသည်…', ja:'宇宙港を開いています…' };

/** Keep inspection UI, translations and rendering code out of the startup bundle. */
export class SpaceportEntry {
  readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private owner: SpaceportView | null = null;
  private loading: Promise<SpaceportView> | null = null;
  private pending: { kind:'preview'|'mission'; close:()=>void; cancel:()=>void; timer:ReturnType<typeof setTimeout>|null } | null = null;
  private lang: Lang = 'en';
  private low = true;
  private reduced = false;
  private disposed = false;
  constructor() {
    this.root.className = 'spaceport-entry';
    this.button.type = 'button'; this.button.id = 'explore-spaceport'; this.button.className = 'chip';
    this.button.addEventListener('click',()=>{
      if (this.pending) return;
      this.request('preview',view=>{ void view.open(); return ()=>view.close(); },()=>{},()=>{});
    });
    this.root.append(this.button);
  }
  get active() { return this.owner?.active ?? false; }
  get viewer() { return this.owner?.preview ?? null; }
  render(lang: Lang, low: boolean, reduced: boolean, available = true) {
    this.lang = lang; this.low = low; this.reduced = reduced;
    if (!available && this.pending?.kind==='preview') this.close();
    this.button.disabled = this.pending?.kind==='preview';
    this.button.textContent = this.button.disabled ? LOADING[lang] : LABEL[lang];
    this.owner?.render(lang,low,reduced);
  }
  private async ensure() {
    if (this.owner) return this.owner;
    if (!this.loading) this.loading = import('./spaceportView').then(({SpaceportView})=>{
      const view = new SpaceportView();
      if (this.disposed) { view.dispose(); throw new Error('Spaceport owner disposed'); }
      this.owner = view; return view;
    }).catch(error=>{ this.loading = null; throw error; });
    return this.loading;
  }
  private request(kind:'preview'|'mission',start:(view:SpaceportView)=>()=>void,complete:()=>void,cancel:()=>void) {
    this.close();
    const request = this.pending = {kind,close:()=>{},cancel,timer:null as ReturnType<typeof setTimeout>|null};
    const release = ()=>{
      if (this.pending !== request) return;
      this.pending = null;
      if (request.timer!==null) clearTimeout(request.timer);
      request.close(); this.button.disabled = false;
    };
    request.timer = setTimeout(()=>{ if(this.pending===request){ release(); complete(); } },20000);
    void this.ensure().then(view=>{
      if (this.pending !== request) return;
      clearTimeout(request.timer!); request.timer = null;
      view.render(this.lang,this.low,this.reduced);
      request.close = start(view);
      // The actual view now owns cancellation and completion.
      if (kind==='preview') this.pending = null;
      this.button.disabled = false;
    }).catch(error=>{
      if (this.pending !== request) return;
      release(); complete(); console.warn('Spaceport interface unavailable',error);
    });
    return release;
  }
  startLaunch(destination:string,complete:()=>void,cancel:()=>void) {
    return this.request('mission',view=>view.startLaunch(destination,complete,cancel),complete,cancel);
  }
  update(dt:number,reduced:boolean) { this.owner?.update(dt,reduced); }
  close() {
    const request = this.pending;
    this.pending = null;
    if (request) { if(request.timer!==null)clearTimeout(request.timer); request.close(); request.cancel(); }
    this.owner?.close(); this.button.disabled = false;
  }
  dispose() { this.disposed = true; this.close(); this.owner?.dispose(); this.root.remove(); }
}
