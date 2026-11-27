import { describe,it,expect } from 'vitest';
import { observeHand } from '../src/gestures/perception';
import { config } from '../src/config';
import { fixtureHand } from './helpers/hands';
import type { Hand } from '../src/tracking/types';

describe('guided thumbs-up observation',()=>{
  it('does not reinterpret real fist, palm, point or V recordings as confirmation',()=>{
    for(const name of ['fist','right_hands','pointing_up','victory']) expect(observeHand(fixtureHand(name),4/3,config.gestures).thumbsUp).toBe(false);
  });
  it('recognizes a synthetic upright straight thumb while retaining legacy fist classification',()=>{
    const h=fixtureHand('fist');
    const landmarks=h.landmarks.map(p=>[...p]) as Hand['landmarks'];
    const [x,y]=landmarks[2];
    const palm=Math.hypot((landmarks[9][0]-landmarks[0][0])*4/3,landmarks[9][1]-landmarks[0][1]);
    landmarks[3]=[x,y-palm*.6,0];landmarks[4]=[x,y-palm*1.4,0];
    const o=observeHand({...h,landmarks},4/3,config.gestures);
    expect(o.thumbsUp).toBe(true);expect(o.pose).toBe('fist');
  });
});
