const percentile=(a:number[],fraction:number)=>{if(!a.length)return 0;const sorted=[...a].sort((x,y)=>x-y);return sorted[Math.ceil((sorted.length-1)*fraction)];};
/** Local aggregate timings only; no camera images or landmarks are retained. */
export class RuntimeMetrics {
  private frames:number[]=[];private inference:number[]=[];private processing:number[]=[];private latency:number[]=[];
  private previous=0;private pending:number|null=null;
  trackingFrames=0;framesWithHands=0;intentCount=0;
  private add(target:number[],n:number){if(Number.isFinite(n)&&n>=0){target.push(n);if(target.length>600)target.shift();}}
  tracking(t:number,detectMs:number,processingMs:number,hands:number,intents:number){
    this.add(this.inference,detectMs);this.add(this.processing,processingMs);this.pending=t;
    this.trackingFrames++;if(hands)this.framesWithHands++;this.intentCount+=intents;
  }
  render(now:number){if(this.previous)this.add(this.frames,now-this.previous);this.previous=now;if(this.pending!==null){this.add(this.latency,now-this.pending);this.pending=null;}}
  reset(){this.frames=[];this.inference=[];this.processing=[];this.latency=[];this.previous=0;this.pending=null;this.trackingFrames=this.framesWithHands=this.intentCount=0;}
  report(){const mean=this.frames.length?this.frames.reduce((sum,n)=>sum+n,0)/this.frames.length:0;return {renderSamples:this.frames.length,fps:mean>0?1000/mean:0,frameP50Ms:percentile(this.frames,.5),frameP95Ms:percentile(this.frames,.95),inferenceP50Ms:percentile(this.inference,.5),inferenceP95Ms:percentile(this.inference,.95),gestureProcessingP95Ms:percentile(this.processing,.95),detectionToRenderP95Ms:percentile(this.latency,.95),trackingFrames:this.trackingFrames,framesWithHands:this.framesWithHands,intentCount:this.intentCount,note:'FPS uses mean render interval. Detection start to render submission excludes sensor capture and display scan-out.'};}
}
