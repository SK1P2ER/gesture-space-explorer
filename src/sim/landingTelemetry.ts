import type { DockingState, DockingParams } from './docking';

/** Values stay in pad radii: the app's worlds have illustrative scales. */
export function landingTelemetry(state: DockingState, params: DockingParams) {
  const offset = Math.hypot(state.x,state.z);
  return { descent:state.outcome?0:params.descent,offset,
    alignment:state.outcome==='landed'?'touchdown':state.outcome==='missed'?'missed':offset<=.65?'aligned':'correct' } as const;
}
