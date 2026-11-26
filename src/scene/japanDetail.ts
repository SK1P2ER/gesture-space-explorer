import type {BaseNode} from './bases';
import type {Object3D} from 'three';

/** The geographic base is an anchor only. All physical art belongs to the metre scene. */
export class JapanDetail {
  private readonly hidden=new Map<Object3D,boolean>();
  readonly status='marker';
  constructor(private readonly base:BaseNode){this.update();}
  update(){for(const object of this.base.group.children){if(!this.hidden.has(object))this.hidden.set(object,object.visible);object.visible=false;}}
  dispose(){for(const [object,visible]of this.hidden)object.visible=visible;this.hidden.clear();}
}
