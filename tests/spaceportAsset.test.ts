import { afterAll,describe,it,expect } from 'vitest';
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const directory = mkdtempSync(join(tmpdir(),'gse-spaceport-validation-'));
const original = readFileSync('public/spaceport/tanegashima-m03.glb');
const manifest = JSON.parse(readFileSync('public/spaceport/manifest.json','utf8'));
writeFileSync(join(directory,'site.json'),readFileSync('public/spaceport/site.json'));
afterAll(()=>{
  const target = resolve(directory),parent = resolve(tmpdir())+sep;
  if (!target.startsWith(parent) || !target.includes('gse-spaceport-validation-')) throw new Error('Unsafe temporary cleanup path');
  rmSync(target,{recursive:true,force:true});
});
function check(asset=original,changes:Record<string,unknown>={}) {
  writeFileSync(join(directory,'tanegashima-m03.glb'),asset);
  writeFileSync(join(directory,'manifest.json'),JSON.stringify({...manifest,asset_sha256:createHash('sha256').update(asset).digest('hex'),...changes}));
  return spawnSync(process.execPath,['scripts/validate-spaceport.mjs','--directory',directory],{encoding:'utf8',windowsHide:true});
}
function mutate(edit:(json:Record<string,any>)=>void) {
  const size = original.readUInt32LE(12),json = JSON.parse(original.subarray(20,20+size).toString());
  edit(json);
  const encoded = Buffer.from(JSON.stringify(json)),length = Math.ceil(encoded.length/4)*4;
  const padded = Buffer.alloc(length,32);encoded.copy(padded);
  const bin = original.subarray(28+size),header = Buffer.alloc(20),binaryHeader=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+length+bin.length,8);header.writeUInt32LE(length,12);header.writeUInt32LE(0x4e4f534a,16);
  binaryHeader.writeUInt32LE(bin.length,0);binaryHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,padded,binaryHeader,bin]);
}
describe('spaceport build gate',()=>{
  it('accepts the real compressed web scene and its source/terrain provenance',()=>{expect(check().status).toBe(0);});
  it('rejects a source mismatch before a stale asset can ship',()=>{
    const result=check(original,{source_sha256:'0'.repeat(64)});expect(result.status).not.toBe(0);expect(result.stderr).toContain('Blend changed');
  });
  it('requires an export after landmark/collision authoring changes',()=>{
    const result=check(original,{authoring_sha256:'0'.repeat(64)});expect(result.status).not.toBe(0);expect(result.stderr).toContain('Landmark authoring changed');
  });
  it('rejects an exported scene that lost its rocket control',()=>{
    const result=check(mutate(json=>{json.nodes.find((node:any)=>node.name==='CTRL | Shuttle ascent').name='Missing ascent root';}));
    expect(result.status).not.toBe(0);expect(result.stderr).toContain('Required animated control');
  });
  it('rejects nonfinite/invalid transforms even when the checksum is updated',()=>{
    const result=check(mutate(json=>{json.nodes[0].translation=[null,0,0];}));expect(result.status).not.toBe(0);expect(result.stderr).toContain('Non-finite');
  });
});
