/** Exhibition-only coordinator. Native Mission remains the owner of flight and stamps. */
export class GuidedSession {
  stage: 'idle'|'review'|'destination'|'outbound'|'exploring'|'return'|'returning'|'complete' = 'idle';
  destination: string | null = null;
  deadline = 0;
  expired = false;
  startedAt = 0;
  completedAt: number|null = null;
  visited: string[] = [];
  get active() { return this.stage !== 'idle' && this.stage !== 'complete'; }
  snapshot() { return JSON.stringify({version:1,stage:this.stage,destination:this.destination,deadline:this.deadline,expired:this.expired,startedAt:this.startedAt,completedAt:this.completedAt,visited:this.visited}); }
  restore(raw:string|null, validIds:readonly string[], now:number) {
    try {
      if(!raw || raw.length>1024)return;
      const v=JSON.parse(raw);
      if(v.version!==1 || !['review','destination','outbound','exploring','return','returning','complete'].includes(v.stage) ||
        !(v.destination===null || validIds.includes(v.destination)) || typeof v.expired!=='boolean' ||
        !Number.isFinite(v.deadline) || v.deadline<=0 || v.deadline>now+300000)return;
      if(['outbound','exploring','returning'].includes(v.stage) && !v.destination)return;
      const start=v.startedAt===undefined?v.deadline-300000:v.startedAt;
      const end=v.completedAt ?? null;
      const visited=v.visited===undefined?[]:v.visited;
      if(!Number.isFinite(start) || start<0 || start>now || start>v.deadline ||
        !(end===null || Number.isFinite(end) && end>=start && end<=now && v.stage==='complete') ||
        !Array.isArray(visited) || visited.length>validIds.length || new Set(visited).size!==visited.length ||
        !visited.every((id:unknown)=>typeof id==='string' && validIds.includes(id)))return;
      this.stage=v.stage;this.destination=v.destination;this.deadline=v.deadline;this.expired=v.expired;
      this.startedAt=start;this.completedAt=end;this.visited=[...visited];
    } catch { /* Invalid guided data never touches native journey storage. */ }
  }
  start(now: number) {
    if (this.active) return;
    this.stage='review'; this.destination=null; this.deadline=now+300000; this.expired=false;
    this.startedAt=now;this.completedAt=null;this.visited=[];
  }
  /** Back to idle, forgetting the journey: used when no native mission is left to continue it. */
  reset() {
    this.stage='idle'; this.destination=null; this.deadline=0; this.expired=false;
    this.startedAt=0; this.completedAt=null; this.visited=[];
  }
  elapsed(now: number) { return Math.max(0,Math.floor(((this.completedAt ?? now)-this.startedAt)/1000)); }
  private finish(now:number) { this.stage='complete';this.completedAt=now; }
  remaining(now: number) { return Math.max(0, Math.ceil((this.deadline-now)/1000)); }
  choose(id: string) { if(this.stage==='destination') this.destination=id; }
  confirm(base: string, now: number): string | null {
    if(this.active && now>=this.deadline && this.stage!=='return' && this.stage!=='exploring') return null;
    if(this.stage==='review') this.stage='destination';
    else if(this.stage==='destination' && this.destination && this.destination!==base) {
      this.stage='outbound'; return this.destination;
    } else if(this.stage==='return' || this.stage==='exploring') {
      if(base==='cape') this.finish(now);
      else { this.stage='returning'; return 'cape'; }
    }
    return null;
  }
  update(mode: string, base: string|null, now: number) {
    if(!this.active) return;
    this.expired ||= now>=this.deadline;
    if(mode!=='baseView') return;
    if(this.stage==='returning' && base==='cape') this.finish(now);
    else if(this.stage==='outbound' && base===this.destination) {
      if(base && !this.visited.includes(base))this.visited.push(base);
      this.stage=this.expired?'return':'exploring';
    }
    if(this.expired && this.active && this.stage!=='outbound' && this.stage!=='returning') {
      if(base==='cape')this.finish(now);else this.stage='return';
    }
  }
}

/** Limits sampled hold time, latches until release, and discards camera stalls. */
export class HoldConfirm {
  progress=0;
  private last: number|null=null;
  private held=0;
  private latched=false;
  private previous=false;
  requireRelease() { this.latched=true;this.held=500;this.progress=1; }
  get waitingRelease() { return this.latched; }
  reset() { this.last=null;this.held=0;this.latched=false;this.previous=false;this.progress=0; }
  update(t: number, present: boolean) {
    const gap=this.last===null?0:t-this.last; this.last=t;
    const continuing=this.previous; this.previous=present;
    if(!present || gap>250 || gap<0) { this.held=0; this.progress=0; if(!present)this.latched=false; }
    if(!present || this.latched) return false;
    this.held+=continuing && gap<=250 ? Math.min(100,Math.max(0,gap)) : 0; this.progress=Math.min(1,this.held/500);
    if(this.progress<1)return false;
    this.latched=true; return true;
  }
}
