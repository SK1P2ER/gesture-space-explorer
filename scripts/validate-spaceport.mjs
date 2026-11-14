import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { resolve,sep } from 'node:path';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const candidate = process.argv.includes('--candidate');
const directoryIndex = process.argv.indexOf('--directory');
const directory = directoryIndex < 0 ? new URL('public/spaceport/',root) : pathToFileURL(resolve(process.argv[directoryIndex+1])+sep);
const path = name => new URL(name, directory);
const asset = readFileSync(path(candidate ? '.tanegashima-m03.candidate.glb' : 'tanegashima-m03.glb'));
const siteBytes = readFileSync(path(candidate ? '.site.candidate.json' : 'site.json'));
const manifest = JSON.parse(readFileSync(path(candidate ? '.manifest.candidate.json' : 'manifest.json'), 'utf8'));
const site = JSON.parse(siteBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(asset.readUInt32LE(0), 0x46546c67, 'GLB magic');
assert.equal(asset.readUInt32LE(4), 2, 'GLB version');
assert.equal(asset.readUInt32LE(8), asset.length, 'Truncated GLB');
assert.ok(asset.length <= 6 * 1024 * 1024, 'Web model exceeds 6 MiB budget');
assert.equal(hash(asset), manifest.asset_sha256, 'Asset hash differs from validated export');
assert.equal(hash(siteBytes), manifest.site_sha256, 'Collision metadata differs from validated export');
assert.equal(manifest.source,'ASTROLIFE_Tanegashima_M03_Launch.blend','Unexpected source asset');
assert.equal(hash(readFileSync(new URL(`assets/spaceport-m03/${manifest.source}`, root))), manifest.source_sha256, 'Blend changed: re-export the web asset');
assert.equal(hash(Buffer.from(readFileSync(new URL('assets/spaceport-m03/site-authoring.json',root),'utf8').replace(/\r\n/g,'\n'))),manifest.authoring_sha256,'Landmark authoring changed: re-export the web asset');
assert.equal(manifest.source_checks, 'passed');
assert.ok(manifest.source_samples >= 60);
assert.ok(manifest.nozzle_alignment_error_m < .001);
assert.equal(manifest.tree_count, 8); assert.equal(manifest.shrub_count, 9);
const jsonLength = asset.readUInt32LE(12);
assert.equal(asset.readUInt32LE(16), 0x4e4f534a);
const gltf = JSON.parse(asset.subarray(20, 20 + jsonLength).toString());
const binStart = 28 + jsonLength;
assert.equal(asset.readUInt32LE(24 + jsonLength), 0x004e4942);
const bin = asset.subarray(binStart);
assert.equal(gltf.buffers.length, 1); assert.ok(!gltf.buffers[0].uri);
assert.ok(gltf.buffers[0].byteLength <= bin.length);
for (const view of gltf.bufferViews) assert.ok((view.byteOffset ?? 0) >= 0 && (view.byteOffset ?? 0) + view.byteLength <= bin.length, 'Buffer view out of range');
const finite = values => values.every(Number.isFinite);
const nodes = gltf.nodes;
const visited = new Set(), stack = new Set(), parents = new Map();
function visit(index) {
  assert.ok(nodes[index], 'Invalid node reference');
  assert.ok(!stack.has(index), 'Cyclic node hierarchy');
  if (visited.has(index)) return;
  stack.add(index);
  const node = nodes[index];
  for (const values of [node.translation, node.rotation, node.scale, node.matrix].filter(Boolean)) assert.ok(finite(values), 'Non-finite transform');
  for (const child of node.children ?? []) { assert.ok(!parents.has(child) || parents.get(child) === index, 'Multiple node parents'); parents.set(child,index); visit(child); }
  stack.delete(index); visited.add(index);
}
nodes.forEach((_,index) => visit(index));
let triangles = 0;
for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
  const position = gltf.accessors[primitive.attributes.POSITION];
  assert.ok(position && finite(position.min) && finite(position.max), 'Geometry needs finite bounds');
  const count = gltf.accessors[primitive.indices]?.count ?? position.count;
  assert.equal(count % 3, 0); triangles += count / 3;
  assert.ok(primitive.extensions?.KHR_draco_mesh_compression, 'Geometry compression missing');
  if (gltf.materials[primitive.material]?.name.includes('Continuous coastal vegetation')) assert.ok(primitive.attributes.COLOR_0 !== undefined, 'Coast colour conversion missing');
}
assert.ok(triangles <= 400000, 'Geometry exceeds 400k triangle budget');
const primitives = nodes.filter(node => node.mesh !== undefined).reduce((sum,node) => sum + gltf.meshes[node.mesh].primitives.length,0);
assert.ok(primitives <= 100, 'Unbatched scene exceeds 100 material draw primitives');
for (const image of gltf.images ?? []) {
  assert.ok(!image.uri && image.bufferView !== undefined, 'Textures must be embedded');
  const view = gltf.bufferViews[image.bufferView];
  const metadata = await sharp(bin.subarray(view.byteOffset ?? 0,(view.byteOffset ?? 0)+view.byteLength)).metadata();
  assert.ok(metadata.width <= 1024 && metadata.height <= 1024, 'Texture exceeds 1K web budget');
}
function values(index) {
  const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
  assert.equal(accessor.componentType, 5126, 'Expected float animation accessor');
  const size = { SCALAR:1, VEC3:3, VEC4:4 }[accessor.type]; assert.ok(size);
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from({length:accessor.count*size}, (_,i) => bin.readFloatLE(start+i*4));
}
const required = new Set(['CTRL | Shuttle ascent','CTRL | Service arm 1','CTRL | Service arm 2',...Array.from({length:5},(_,i)=>`FX | core jet ${i}`),...Array.from({length:5},(_,i)=>`FX | outer jet ${i}`)]);
for (const animation of gltf.animations ?? []) for (const channel of animation.channels) {
  const sampler = animation.samplers[channel.sampler], times = values(sampler.input), output = values(sampler.output);
  assert.ok(finite(times) && finite(output));
  assert.ok(times.every((time,i) => i===0 || time>times[i-1]), 'Animation keys are not increasing');
  assert.ok(times[0] >= 0 && times.at(-1) <= 479/24+.01, 'Animation timeline outside the authored sequence');
  const name = nodes[channel.target.node].name;
  required.delete(name);
  if (name === 'CTRL | Shuttle ascent') {
    assert.ok(times[0] <= 1/24+.001 && Math.abs(times.at(-1)-479/24)<.01, 'Ascent timeline changed');
    assert.equal(channel.target.path, 'translation'); assert.ok(Math.abs(output[1]-13)<.01 && output.at(-2)>350);
    assert.ok(output.filter((_,i)=>i%3===1).every((y,i,all)=>i===0 || y>=all[i-1]-.001), 'Ascent reverses direction');
  }
  if (name.startsWith('CTRL | Service arm')) {
    assert.equal(channel.target.path,'rotation');
    const angle = 2*Math.acos(Math.min(1,Math.abs(output.at(-1))));
    assert.ok(Math.abs(angle-88*Math.PI/180)<.01,'Service arm export angle changed');
  }
  if (name.startsWith('FX |')) { assert.equal(channel.target.path,'scale'); assert.ok(Math.max(...output.slice(-3))>10,'Exhaust scale animation missing'); }
}
assert.deepEqual([...required], [], 'Required animated control is missing');
assert.equal(site.version, 1);
const terrain = site.terrain;
assert.equal(terrain.heights.length, terrain.columns*terrain.rows);
assert.ok(terrain.dx>0 && terrain.dz>0 && finite(terrain.heights));
assert.deepEqual(site.landmarks.map(item=>item.id).sort(), ['assembly','control','landing','pad']);
for (const box of [...site.colliders,...site.landmarks.map(item=>item.bounds)]) assert.ok(finite(box.min)&&finite(box.max)&&box.min.every((v,i)=>v<=box.max[i]), 'Invalid collision bounds');
assert.ok(site.colliders.length >= 5);
for (const landmark of site.landmarks) assert.ok(finite(landmark.eye)&&finite(landmark.target),'Invalid landmark camera');
assert.deepEqual(site.landing.center, [-175,7.025,85]); assert.equal(site.landing.radius,32); assert.equal(site.landing.approach_seconds,8);
console.log(`[spaceport] validated ${asset.length} bytes, ${triangles} triangles, ${primitives} primitives, ${manifest.source_samples} source samples: ${fileURLToPath(path('tanegashima-m03.glb'))}`);
