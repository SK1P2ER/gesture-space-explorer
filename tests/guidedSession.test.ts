import { describe, it, expect } from 'vitest';
import { GuidedSession, HoldConfirm } from '../src/app/guidedSession';

describe('guided session', () => {
  it('requires explicit start and passenger confirmation before launch', () => {
    const s = new GuidedSession();
    expect(s.confirm('cape', 0)).toBe(null);
    s.start(1000); expect(s.stage).toBe('review');
    s.confirm('cape', 1100); expect(s.stage).toBe('destination');
    expect(s.confirm('cape', 1200)).toBe(null);
    s.choose('jezero'); expect(s.confirm('cape', 1300)).toBe('jezero');
    expect(s.confirm('cape', 1400)).toBe(null);
  });
  it('expires by wall clock without interrupting flight, and returns only after landing', () => {
    const s = new GuidedSession(); s.start(0); s.confirm('cape', 1); s.choose('jezero'); s.confirm('cape', 2);
    s.update('travel', 'cape', 300001); expect(s.stage).toBe('outbound'); expect(s.expired).toBe(true);
    s.update('baseView', 'jezero', 300002); expect(s.stage).toBe('return');
    expect(s.confirm('jezero', 300003)).toBe('cape');
    s.update('baseView', 'jezero', 300004); expect(s.stage).toBe('returning');
    s.update('baseView', 'cape', 300005); expect(s.stage).toBe('complete');
  });
  it('does not accept a destination equal to departure', () => {
    const s = new GuidedSession(); s.start(0); s.confirm('cape', 1); s.choose('cape');
    expect(s.confirm('cape', 2)).toBe(null);
  });
  it('ends an expired preflight safely on Earth', () => {
    const s = new GuidedSession(); s.start(0); s.update('baseView', 'cape', 300000);
    expect(s.stage).toBe('complete');
  });
  it('does not restart an active session or extend its deadline', () => {
    const s = new GuidedSession(); s.start(0); s.start(100000);
    expect(s.remaining(200000)).toBe(100);
  });
});
describe('guided confirmation hold', () => {
  it('requires a sustained hold and neutral release between confirmations', () => {
    const h = new HoldConfirm();
    for (let t=0;t<500;t+=100) expect(h.update(t, true)).toBe(false);
    expect(h.update(500,true)).toBe(true); expect(h.update(600,true)).toBe(false);
    h.update(700,false);
    for(let t=800;t<1300;t+=100) expect(h.update(t,true)).toBe(false);
    expect(h.update(1300,true)).toBe(true);
  });
  it('does not count tracking stalls as continuous observed holds', () => {
    const h = new HoldConfirm(); h.update(0,true); expect(h.update(5000,true)).toBe(false);
    expect(h.progress).toBeLessThan(1);
  });
  // Injected observations: the camera stopping is modelled by interrupt(), with the next frame arriving sooner than any stall limit.
  it('a hold cut off by the camera stopping shows no progress and cannot be finished by the next session', () => {
    const h = new HoldConfirm();
    for (let t=0;t<=400;t+=100) expect(h.update(t,true)).toBe(false);
    expect(h.progress).toBeCloseTo(0.8);
    h.interrupt();
    expect(h.progress).toBe(0);
    expect(h.update(500,true)).toBe(false); // would have completed the old hold
    expect(h.progress).toBe(0);
    for (let t=600;t<1000;t+=100) expect(h.update(t,true)).toBe(false);
    expect(h.update(1000,true)).toBe(true); // a whole new hold confirms
  });
  it('a 👍 that still has to be released stays that way through a camera stop', () => {
    const h = new HoldConfirm(); h.requireRelease();
    h.interrupt();
    expect(h.waitingRelease).toBe(true);
    for (let t=0;t<=1000;t+=100) expect(h.update(t,true)).toBe(false);
    h.update(1100,false);
    for (let t=1200;t<1700;t+=100) expect(h.update(t,true)).toBe(false);
    expect(h.update(1700,true)).toBe(true);
  });
});

describe('guided refresh compatibility', () => {
  it('restores wall-clock deadline without personal data or native checkpoint changes', () => {
    const s=new GuidedSession();s.start(1000);s.confirm('cape',1100);s.choose('jezero');s.confirm('cape',1200);
    const r=new GuidedSession();r.restore(s.snapshot(),['cape','jezero'],5000);
    expect(r.stage).toBe('outbound');expect(r.remaining(5000)).toBe(296);
  });
  it('ignores malformed, unknown destinations and future deadlines', () => {
    for(const raw of ['{', '{"version":9}',JSON.stringify({version:1,stage:'outbound',destination:'unknown',deadline:3000,expired:false}),JSON.stringify({version:1,stage:'review',destination:null,deadline:900000,expired:false})]) {
      const s=new GuidedSession();s.restore(raw,['cape'],0);expect(s.stage).toBe('idle');
    }
  });
});

describe('guided end-of-experience summary',()=>{
  it('counts only actual destination arrivals and freezes elapsed time on completion',()=>{
    const s=new GuidedSession();s.start(1000);s.confirm('cape',1100);s.choose('jezero');s.confirm('cape',1200);
    expect(s.visited).toEqual([]);
    s.update('travel','cape',5000);expect(s.visited).toEqual([]);
    s.update('baseView','jezero',61000);expect(s.visited).toEqual(['jezero']);
    s.confirm('jezero',62000);s.update('baseView','cape',121000);
    expect(s.elapsed(900000)).toBe(120);expect(s.completedAt).toBe(121000);
    s.update('baseView','cape',950000);expect(s.elapsed(950000)).toBe(120);
  });
  it('restores summary across refresh and resets only guided statistics for the next guest',()=>{
    const s=new GuidedSession();s.start(1000);s.confirm('cape',1100);s.choose('jezero');s.confirm('cape',1200);
    s.update('baseView','jezero',5000);s.confirm('jezero',5100);s.update('baseView','cape',10000);
    const r=new GuidedSession();r.restore(s.snapshot(),['cape','jezero'],11000);
    expect(r.visited).toEqual(['jezero']);expect(r.elapsed(99000)).toBe(9);
    r.start(12000);expect(r.visited).toEqual([]);expect(r.elapsed(13000)).toBe(1);expect(r.completedAt).toBe(null);
  });
  it('accepts older records without inventing visits, and rejects malformed optional statistics',()=>{
    const raw={version:1,stage:'complete',destination:'jezero',deadline:301000,expired:true};
    const s=new GuidedSession();s.restore(JSON.stringify(raw),['cape','jezero'],400000);
    expect(s.stage).toBe('complete');expect(s.visited).toEqual([]);expect(s.completedAt).toBe(null);
    for(const stats of [{visited:['unknown']},{visited:['jezero','jezero']},{startedAt:'bad'},{completedAt:9999999999}]) {
      const invalid=new GuidedSession();invalid.restore(JSON.stringify({...raw,...stats}),['cape','jezero'],400000);
      expect(invalid.stage).toBe('idle');
    }
  });
});
describe('guided confirmation feedback',()=>{
 it('shows release-required until a neutral observation and clears on a new session',()=>{
   const h=new HoldConfirm();for(let t=0;t<=500;t+=100)h.update(t,true);
   expect(h.waitingRelease).toBe(true);h.update(600,true);expect(h.waitingRelease).toBe(true);
   h.update(700,false);expect(h.waitingRelease).toBe(false);
   for(let t=800;t<=1400;t+=100)h.update(t,true);
   h.reset();expect(h.waitingRelease).toBe(false);expect(h.progress).toBe(0);
 });
});
describe('guided session reset', () => {
  it('returns to idle and forgets the journey (nothing native left to continue)', () => {
    const s = new GuidedSession(); s.start(1000); s.confirm('cape', 1100); s.choose('jezero'); s.confirm('cape', 1200);
    expect(s.stage).toBe('outbound');
    s.reset();
    expect(JSON.parse(s.snapshot())).toEqual({ version: 1, stage: 'idle', destination: null, deadline: 0, expired: false, startedAt: 0, completedAt: null, visited: [] });
    expect(s.active).toBe(false);
    s.start(5000); expect(s.stage).toBe('review'); expect(s.remaining(5000)).toBe(300);
  });
});
