import type {DockingState} from './docking';
export interface SpaceportVehicle {
  phase:'baseView'|'launch'|'docking';
  stacked:boolean;
  docking:DockingState|null;
}
/** Rendering only. The shared Mission remains the sole owner of physics and outcomes. */
export function spaceportPose(vehicle:SpaceportVehicle,landing:{center:readonly number[];radius:number}) {
  const s=vehicle.docking;
  if(vehicle.phase==='docking'&&s) return {
    x:landing.center[0]+landing.radius*(.8*s.x-.6*s.z),
    y:landing.center[1]+landing.radius*s.alt+.04,
    z:landing.center[2]+landing.radius*(.6*s.x+.8*s.z),
    thrust:s.outcome?0:.6,
  };
  return vehicle.stacked?{x:0,y:13,z:0,thrust:vehicle.phase==='launch'?.25:0}
    :{x:landing.center[0],y:landing.center[1]+.04,z:landing.center[2],thrust:vehicle.phase==='launch'?.25:0};
}
