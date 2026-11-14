import {expect,it} from 'vitest';
import {parseCheckpoint,writeCheckpoint,readCheckpoint,type MissionCheckpoint} from '../src/app/checkpoint';
const good:MissionCheckpoint={version:1,savedAt:Date.now(),time:Date.UTC(2026,10,8),lang:'my',baseId:'cape',destinationId:'tranquility',phase:'base',stacked:true,fuel:.2};
it('round-trips a saved base and rejects invalid or corrupted local data',()=>{
  expect(parseCheckpoint(JSON.stringify(good))).toEqual(good);
  for(const raw of ['null','{','[]',JSON.stringify({...good,baseId:'unknown'}),JSON.stringify({...good,version:2}),JSON.stringify({...good,time:1e100}),JSON.stringify({...good,phase:'travel',trip:{}})])expect(parseCheckpoint(raw)).toBeNull();
});
it('remembers a valid view choice and rejects unknown renderer state',()=>{
  expect(parseCheckpoint(JSON.stringify({...good,view:'spaceport'}))?.view).toBe('spaceport');
  expect(parseCheckpoint(JSON.stringify({...good,view:'unknown'}))).toBeNull();
});
it('does not break the mission when browser storage is blocked',()=>{
  const storage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
  expect(readCheckpoint(storage)).toBeNull();expect(()=>writeCheckpoint(storage,good)).not.toThrow();
});
