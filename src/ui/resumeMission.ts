import type {MissionCheckpoint} from '../app/checkpoint';
import {baseById} from '../data/bases';
import type {Lang} from '../data/bodies';

export class ResumeMission {
  private readonly root=document.createElement('aside');
  private readonly text=document.createElement('p');
  private readonly resume=document.createElement('button');
  private readonly discard=document.createElement('button');
  /** Shown once something that would change the journey was refused: the choice comes first. */
  private readonly hint=document.createElement('p');
  constructor(private readonly snapshot:MissionCheckpoint,complete:(resume:boolean)=>void) {
    this.root.id='resume-mission';this.root.className='mission-resume';this.root.setAttribute('aria-label','Saved mission');
    this.resume.id='resume-mission-continue';this.discard.id='resume-mission-discard';
    this.hint.className='resume-hint';this.hint.setAttribute('role','status');this.hint.setAttribute('aria-live','polite');this.hint.hidden=true;
    for(const [button,choice] of [[this.resume,true],[this.discard,false]] as const){button.type='button';button.className='chip';button.addEventListener('click',()=>{this.root.remove();complete(choice);});}
    this.root.append(this.text,this.resume,this.discard,this.hint);document.body.append(this.root);
  }
  /** Something that would start, redirect or replace a journey was refused. Focus stays put: Enter must not answer for the user. */
  remind(lang:Lang) {
    if(!this.hint.hidden)return; // already shown; render() keeps its language current
    this.hint.hidden=false;
    this.render(lang);
    this.root.classList.add('remind');
  }
  render(lang:Lang) {
    const destination=baseById(this.snapshot.trip?.toId??this.snapshot.baseId).name[lang];
    this.text.textContent={en:`Continue your saved mission · ${destination}?`,my:`သိမ်းထားသော ခရီးကို ပြန်ဆက်မလား · ${destination}။`,ja:`保存したミッションを再開 · ${destination}？`}[lang];
    this.resume.textContent={en:'Continue mission',my:'ခရီးပြန်ဆက်ရန်',ja:'ミッションを再開'}[lang];
    this.discard.textContent={en:'Start fresh',my:'အသစ်စရန်',ja:'新しく始める'}[lang];
    if(this.hint.hidden)return;
    // A live region: write it only when the words change (a language switch), never per frame or per refusal.
    const hint={en:'Choose Continue mission or Start fresh first.',my:'သိမ်းထားတဲ့ခရီးကို ဆက်မလား၊ အသစ်စမလား အရင်ရွေးပါ။',ja:'先に「ミッションを再開」か「新しく始める」を選んでください。'}[lang];
    if(this.hint.textContent!==hint)this.hint.textContent=hint;
  }
}
