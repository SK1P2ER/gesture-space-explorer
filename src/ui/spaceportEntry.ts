import type { Lang } from '../data/bodies';
import type { SpaceportView } from './spaceportView';
import { t } from './i18n';
import type { GestureInput } from '../app/spaceportGestures';

/** Keep inspection UI, translations and rendering code out of the startup bundle. */
export class SpaceportEntry {
  readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly label = document.createElement('span');
  /**
   * The view the launch preview covers (main.ts: the ground spaceport). Its camera pose is saved when the preview opens
   * and restored when it closes, however it closes (Close, Escape, leaving the base), so angle, zoom and target return.
   */
  groundView: { save: () => unknown; restore: (pose: unknown) => void } | null = null;
  private owner: SpaceportView | null = null;
  private loading: Promise<SpaceportView> | null = null;
  private pending: { kind:'preview'|'mission'; close:()=>void; cancel:()=>void; timer:ReturnType<typeof setTimeout>|null } | null = null;
  private lang: Lang = 'en';
  private low = true;
  private reduced = false;
  private disposed = false;
  constructor() {
    this.root.className = 'spaceport-entry';
    this.button.type = 'button'; this.button.id = 'explore-spaceport'; this.button.className = 'chip'; this.button.dataset.ui = 'spaceport-entry';
    // The base card's primary action (amber, with ▶); its accessible name stays the localized label alone.
    const icon = document.createElement('span'); icon.className = 'spaceport-entry-icon'; icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
    this.label.className = 'spaceport-entry-label';
    this.button.append(icon, this.label);
    this.button.addEventListener('click',()=> this.openPreview(this.button));
    this.root.append(this.button);
  }
  private openPreview(opener: HTMLButtonElement) {
    if (this.pending) return;
    const pose = this.groundView?.save() ?? null;
    this.request('preview', view => {
      void view.open(() => this.returnFromPreview(opener, pose));
      return () => view.close();
    }, () => {}, () => {});
  }

  /** The preview has closed: the ground camera goes back where it was and focus back to the button that opened it. */
  private returnFromPreview(opener: HTMLButtonElement, pose: unknown) {
    if (pose !== null) this.groundView?.restore(pose);
    // Only if it can take focus (still in the page, shown, enabled); otherwise the browser's own dialog focus return stands.
    if (opener.isConnected && !opener.disabled && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
  }
  get active() { return this.owner?.active ?? false; }
  get viewer() { return this.owner?.preview ?? null; }
  /** The open launch preview owns hand input (item 2): main.ts sends it each detection and keeps the engine's own actions off. */
  get ownsHand() { return this.owner?.ownsHand ?? false; }
  observeHand(input: GestureInput) { this.owner?.observeHand(input); }
  trackingStopped() { this.owner?.trackingStopped(); }
  render(lang: Lang, low: boolean, reduced: boolean, available = true) {
    this.lang = lang; this.low = low; this.reduced = reduced;
    if (!available && this.pending?.kind==='preview') this.close();
    this.button.disabled = this.pending?.kind==='preview';
    const text = t(this.button.disabled ? 'sp.opening' : 'sp.entry', lang);
    if (this.label.textContent !== text) this.label.textContent = text;
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
