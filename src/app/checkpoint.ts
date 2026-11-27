import {BASES} from '../data/bases';
import {MIN_TIME,MAX_TIME} from '../sim/clock';
import type {DockingState} from '../sim/docking';
import type {Lang} from '../data/bodies';

export const CHECKPOINT_KEY='gse.mission.v1';
export interface MissionCheckpoint {
  version:1;savedAt:number;time:number;lang:Lang;baseId:string;destinationId:string|null;stacked:boolean;fuel:number;
  phase:'base'|'travel'|'docking';
  view?:'globe'|'spaceport';
  trip?:{fromId:string;toId:string;elapsed:number;seconds:number;km:number;fuel:number;lander:boolean};
  dock?:{state:DockingState;auto:boolean;misses:number;settle:number;legT:number};
}
const finite=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const validBase=(id:unknown):id is string=>typeof id==='string'&&BASES.some(b=>b.id===id);
/** Invalid/old snapshots are discarded without affecting startup or existing settings. */
export function parseCheckpoint(raw:string|null):MissionCheckpoint|null {
  if(!raw||raw.length>4096)return null;
  try {
    const s=JSON.parse(raw) as MissionCheckpoint;
    if(s.view!==undefined&&s.view!=='globe'&&s.view!=='spaceport')return null;
    if(s.version!==1||!validBase(s.baseId)||!(s.destinationId===null||validBase(s.destinationId))||s.destinationId===s.baseId||typeof s.stacked!=='boolean'||!finite(s.fuel,0,1)||!['en','my','ja'].includes(s.lang)||!finite(s.time,MIN_TIME,MAX_TIME)||!finite(s.savedAt,0,Date.now()+60000))return null;
    if(s.phase==='travel') {
      const t=s.trip;
      if(!t||!validBase(t.fromId)||!validBase(t.toId)||t.fromId===t.toId||s.baseId!==t.fromId||s.destinationId!==t.toId||!finite(t.seconds,1,600)||!finite(t.elapsed,0,t.seconds)||!finite(t.km,0,1e12)||!finite(t.fuel,0,1)||typeof t.lander!=='boolean')return null;
    }else if(s.phase==='docking') {
      const d=s.dock,p=d?.state;
      if(!d||!p||!finite(p.x,-100,100)||!finite(p.z,-100,100)||!finite(p.alt,0,10)||!finite(p.vx,-10,10)||!finite(p.vz,-10,10)||!finite(p.t,0,600)||![null,'landed','missed'].includes(p.outcome)||typeof d.auto!=='boolean'||!finite(d.misses,0,10000)||!finite(d.settle,0,.81)||!finite(d.legT,0,600))return null;
      if((p.outcome!==null)!==(p.alt===0))return null;
    }else if(s.phase!=='base')return null;
    return s;
  }catch{return null;}
}
export function readCheckpoint(storage:Pick<Storage,'getItem'>|null) {try{return parseCheckpoint(storage?.getItem(CHECKPOINT_KEY)??null);}catch{return null;}}
export function writeCheckpoint(storage:Pick<Storage,'setItem'|'removeItem'>|null,value:MissionCheckpoint|null) {
  try{if(value)storage?.setItem(CHECKPOINT_KEY,JSON.stringify(value));else storage?.removeItem(CHECKPOINT_KEY);}catch{/* Storage is optional. */}
}
