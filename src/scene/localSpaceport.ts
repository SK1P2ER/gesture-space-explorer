import type {LocalSpaceportScene} from './localSpaceportScene';
import type {SpaceportVehicle} from '../sim/spaceportView';
import type {Insets} from './cameraRig';

/** One view lease, independent of the sole Mission simulation. */
export class LocalSpaceport {
  readonly host=document.createElement('div');
  requested=false;
  status:'idle'|'loading'|'ready'|'failed'='idle';
  resolutionScale=1;
  private scene:LocalSpaceportScene|null=null;
  private loadingScene:LocalSpaceportScene|null=null;
  private controller:AbortController|null=null;
  private suppressed=false;
  private wasDocking=false;
  private low=true;
  constructor(private readonly steer:(x:number,y:number)=>void){this.host.id='local-spaceport';this.host.hidden=true;document.body.append(this.host);}
  get active(){return this.requested&&this.status==='ready';}
  get canvas(){return this.active?this.scene?.renderer.domElement??null:null;}
  get camera(){return this.scene?.camera??null;}
  get renderer(){return this.active?this.scene?.renderer??null:null;}
  get vehicleObject(){return this.scene?.vehicleObject??null;}
  enter(){this.requested=true;this.suppressed=false;if(this.status==='failed')this.release();this.ensure();}
  map(){this.requested=false;this.suppressed=true;this.host.hidden=true;}
  reset(){this.scene?.reset();}
  rotate(dx:number,dy:number){this.scene?.rotate(dx,dy);}
  zoom(factor:number){this.scene?.zoom(factor);}
  restore(view:'globe'|'spaceport'){if(view==='spaceport')this.enter();else this.map();}
  sync(available:boolean,docking:boolean,inbound:boolean,low:boolean){
    this.low=low;
    if(!available){this.requested=false;this.suppressed=false;}
    if(docking&&!this.wasDocking&&!this.suppressed)this.enter();
    this.wasDocking=docking;
    if(!available&&!inbound){this.release();this.host.hidden=true;return;}
    if(inbound||this.requested)this.ensure();
    this.host.hidden=!this.active;
  }
  private ensure(){
    if(this.status!=='idle')return;
    const controller=this.controller=new AbortController();this.status='loading';
    const deadline=setTimeout(()=>{if(this.controller===controller){controller.abort();this.loadingScene?.dispose();this.loadingScene=null;this.status='failed';}},20000);
    void import('./localSpaceportScene').then(async({LocalSpaceportScene})=>{
      if(controller.signal.aborted)return;
      const scene=this.loadingScene=new LocalSpaceportScene(this.host,this.low,this.steer);
      try {
        await scene.load(controller.signal);
        if(controller.signal.aborted||this.controller!==controller){scene.dispose();return;}
        this.loadingScene=null;this.scene=scene;this.status='ready';this.host.hidden=!this.active;
      }catch(error){scene.dispose();throw error;}
    }).catch(error=>{if(this.controller!==controller)return;this.loadingScene=null;this.status='failed';console.warn('Ground spaceport unavailable; Earth map remains usable',error);}).finally(()=>clearTimeout(deadline));
  }
  render(state:SpaceportVehicle,dt:number,low:boolean,night:number,insets:Readonly<Insets>,reduced:boolean,scale=1){this.resolutionScale=Math.max(.6,scale);if(this.active)this.scene?.render(state,dt,low,night,insets,reduced,this.resolutionScale);}
  private release(){this.controller?.abort();this.controller=null;this.loadingScene?.dispose();this.loadingScene=null;this.scene?.dispose();this.scene=null;this.status='idle';}
  dispose(){this.release();this.host.remove();}
}
