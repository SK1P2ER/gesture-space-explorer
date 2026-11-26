import {describe,it,expect} from 'vitest';
import {SpaceportTap} from '../src/scene/spaceportTap';
const pointer = (pointerId=1,clientX=100,clientY=100,isPrimary=true,button=0) => ({pointerId,clientX,clientY,isPrimary,button});
describe('spaceport tap ownership',()=>{
  it('accepts one primary tap with small movement',()=>{
    const tap=new SpaceportTap();tap.down(pointer());tap.move(pointer(1,102,101));expect(tap.up(pointer(1,103,102))).toBe(true);
    expect(tap.up(pointer())).toBe(false);
  });
  it.each([false,true])('rejects both releases after a pinch, primary released first: %s',primaryFirst=>{
    const tap=new SpaceportTap(),first=pointer(),second=pointer(2,200,100,false);
    tap.down(first);tap.down(second);
    for(const event of primaryFirst?[first,second]:[second,first])expect(tap.up(event)).toBe(false);
    tap.down(first);expect(tap.up(first)).toBe(true);
  });
  it('does not pick after an orbit drag returns to its starting position',()=>{
    const tap=new SpaceportTap();tap.down(pointer());tap.move(pointer(1,160,100));tap.move(pointer());expect(tap.up(pointer())).toBe(false);
  });
  it('keeps right/middle-button panning and cancelled gestures out of picking',()=>{
    const tap=new SpaceportTap();
    for(const button of [1,2]){const event=pointer(1,100,100,true,button);tap.down(event);expect(tap.up(event)).toBe(false);}
    tap.down(pointer());tap.cancel();expect(tap.up(pointer())).toBe(false);
  });
});
