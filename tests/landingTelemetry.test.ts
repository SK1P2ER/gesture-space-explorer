import {expect,it} from 'vitest';
import {startDocking,dockingParams,stepDocking} from '../src/sim/docking';
import {landingTelemetry} from '../src/sim/landingTelemetry';
it('reports actual offset, descent and touchdown without invented metre units',()=>{
  const params=dockingParams(9.8),state=startDocking(1);
  expect(landingTelemetry(state,params)).toEqual({offset:0,descent:.85,alignment:'aligned'});
  expect(landingTelemetry({...state,x:1,z:1},params).alignment).toBe('correct');
  expect(landingTelemetry(stepDocking(state,2,params,null,true),params)).toEqual({offset:0,descent:0,alignment:'touchdown'});
  expect(landingTelemetry({...state,alt:0,outcome:'missed'},params).alignment).toBe('missed');
});
