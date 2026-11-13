import type {MissionCheckpoint} from '../app/checkpoint';
import {baseById} from '../data/bases';
import type {Lang} from '../data/bodies';

export class ResumeMission {
  private readonly root=document.createElement('aside');
  private readonly text=document.createElement('p');
  private readonly resume=document.createElement('button');
  private readonly discard=document.createElement('button');
  constructor(private readonly snapshot:MissionCheckpoint,complete:(resume:boolean)=>void) {
    this.root.id='resume-mission';this.root.className='mission-resume';this.root.setAttribute('aria-label','Saved mission');
    this.resume.id='resume-mission-continue';this.discard.id='resume-mission-discard';
    for(const [button,choice] of [[this.resume,true],[this.discard,false]] as const){button.type='button';button.className='chip';button.addEventListener('click',()=>{this.root.remove();complete(choice);});}
    this.root.append(this.text,this.resume,this.discard);document.body.append(this.root);
  }
  render(lang:Lang) {
    const destination=baseById(this.snapshot.trip?.toId??this.snapshot.baseId).name[lang];
    this.text.textContent={en:`Continue your saved mission · ${destination}?`,my:`သိမ်းထားသော ခရီးကို ပြန်ဆက်မလား · ${destination}။`,ja:`保存したミッションを再開 · ${destination}？`}[lang];
    this.resume.textContent={en:'Continue mission',my:'ခရီးပြန်ဆက်ရန်',ja:'ミッションを再開'}[lang];
    this.discard.textContent={en:'Start fresh',my:'အသစ်စရန်',ja:'新しく始める'}[lang];
  }
}
