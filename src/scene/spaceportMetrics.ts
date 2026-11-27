export class SpaceportMetrics {
  private readonly frames: number[] = [];
  private readonly cpu: number[] = [];
  private total = 0;
  loadMs = 0;
  drawCalls = 0;
  triangles = 0;
  add(frameMs: number, cpuMs: number, calls: number, triangles: number) {
    if (frameMs <= 0 || frameMs > 1000) return;
    this.frames.push(frameMs); this.cpu.push(cpuMs); this.total++;
    if (this.frames.length > 240) { this.frames.shift(); this.cpu.shift(); }
    this.drawCalls = calls; this.triangles = triangles;
  }
  reset() { this.frames.length = this.cpu.length = this.total = 0; }
  snapshot() {
    const sorted = [...this.frames].sort((a,b)=>a-b), cpu = [...this.cpu].sort((a,b)=>a-b);
    const percentile = (values: number[],p: number) => values.length ? values[Math.min(values.length-1,Math.floor(values.length*p))] : 0;
    const median = percentile(sorted,.5);
    return { samples:this.frames.length, totalFrames:this.total, fps:median ? 1000/median : 0, frameP95Ms:percentile(sorted,.95), cpuP95Ms:percentile(cpu,.95), loadMs:this.loadMs, drawCalls:this.drawCalls, triangles:this.triangles };
  }
}
