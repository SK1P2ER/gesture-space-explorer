import {expect,it} from 'vitest';
import * as THREE from 'three';
import {JapanDetail} from '../src/scene/japanDetail';
import type {BaseNode} from '../src/scene/bases';
it('keeps all physical Japan art out of the globe at every zoom and restores owned visibility on disposal',()=>{
 const group=new THREE.Group(),building=new THREE.Group(),pad=new THREE.Group();group.add(building,pad);
 const detail=new JapanDetail({group} as unknown as BaseNode);
 expect(building.visible).toBe(false);expect(pad.visible).toBe(false);
 building.visible=true;detail.update();expect(building.visible).toBe(false);
 detail.dispose();expect(building.visible).toBe(true);expect(pad.visible).toBe(true);
});
