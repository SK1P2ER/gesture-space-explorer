import {expect,it} from 'vitest';
import {spaceportPose,type SpaceportVehicle} from '../src/sim/spaceportView';
const landing={center:[-175,7.025,85],radius:32};
it('maps the same docking state to metres without changing the attempt or outcome',()=>{
  const docking={x:1,z:2,alt:3,vx:0,vz:0,t:4,outcome:null};
  const before=JSON.stringify(docking),view={phase:'docking',stacked:false,docking} as SpaceportVehicle;
  const pose=spaceportPose(view,landing);expect(pose.x).toBeCloseTo(-187.8);expect(pose.y).toBeCloseTo(103.065);expect(pose.z).toBeCloseTo(155.4);expect(pose.thrust).toBe(.6);
  expect(JSON.stringify(docking)).toBe(before);
  expect(spaceportPose({...view,docking:{...docking,alt:0,outcome:'landed'}},landing).thrust).toBe(0);
});
it('parks full stacks at the launch complex and arriving landers at the clear landing pad',()=>{
  expect(spaceportPose({phase:'baseView',stacked:true,docking:null},landing)).toMatchObject({x:0,y:13,z:0});
  expect(spaceportPose({phase:'baseView',stacked:false,docking:null},landing)).toMatchObject({x:-175,y:7.065,z:85});
});
