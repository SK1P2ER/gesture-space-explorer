import {expect,it} from 'vitest';
import {RuntimeMetrics} from '../src/performance/runtimeMetrics';
it('measures inference, processing and detection-to-render with bounded samples',()=>{
  const metrics=new RuntimeMetrics();
  metrics.render(100);metrics.tracking(105,4,1,1,2);metrics.render(116);
  expect(metrics.report()).toMatchObject({fps:62.5,inferenceP95Ms:4,gestureProcessingP95Ms:1,detectionToRenderP95Ms:11,framesWithHands:1,intentCount:2});
  for(let i=1;i<=800;i++)metrics.render(116+i*16);
  expect(metrics.report().renderSamples).toBe(600);metrics.reset();expect(metrics.report().trackingFrames).toBe(0);
});
it('reports actual average throughput when inference creates uneven render intervals',()=>{
  const metrics=new RuntimeMetrics();for(const t of [100,116,120,152])metrics.render(t);
  expect(metrics.report().fps).toBeCloseTo(3000/52);
  expect(metrics.report().frameP95Ms).toBe(32);
});
