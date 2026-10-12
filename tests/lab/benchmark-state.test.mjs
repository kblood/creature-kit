import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkMembers,benchmarkTier,sampleStats} from '../../apps/creature-lab/src/benchmark-state.ts';
import {BenchmarkGpuTimer} from '../../apps/creature-lab/src/benchmark-gpu.ts';
const options={count:64,collection:'mixed',placement:'distances',lod:'auto'};
test('population identity and positions are independent of rendering optimizations',()=>{
 const before=benchmarkMembers(options);
 assert.deepEqual(benchmarkMembers({...options,instancing:false,sharePose:true,lod:'1000'}),before);
 assert.equal(new Set(before.map(m=>m.id)).size,64);
 assert.equal(new Set(before.map(m=>m.source)).size,6);
 assert.deepEqual(new Set(before.map(m=>benchmarkTier(Math.hypot(m.position[0],m.position[1]-2.5,m.position[2]-12),'auto'))),new Set(['source','4500','1000']));
 assert.throws(()=>benchmarkMembers({...options,count:9999}));
});
test('LOD thresholds and hysteresis match the Atlas planet tiers',()=>{
 assert.equal(benchmarkTier(34,'auto'),'source');assert.equal(benchmarkTier(35,'auto'),'4500');assert.equal(benchmarkTier(140,'auto'),'1000');
 assert.equal(benchmarkTier(38,'auto','source'),'source');assert.equal(benchmarkTier(38.5,'auto','source'),'4500');
 assert.equal(benchmarkTier(127,'auto','1000'),'1000');assert.equal(benchmarkTier(125,'auto','1000'),'4500');
 assert.equal(benchmarkTier(1,'1000'),'1000');
});
test('timing percentiles use measured samples without mutating them or inventing unsupported GPU data',()=>{
 const samples=[10,1,2,3,4,5,6,7,8,9],copy=[...samples];const stats=sampleStats(samples);
 assert.equal(stats.median,5);assert.equal(stats.p95,10);assert.equal(stats.mean,5.5);assert.deepEqual(samples,copy);
 assert.equal(sampleStats([]),null);assert.throws(()=>sampleStats([NaN]));
});
test('GPU timing is bounded, asynchronous, run-tagged, disjoint-aware and disposable',()=>{
 let next=0,available=false,disjoint=false,deletes=0;
 const gl={getExtension:()=>({TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2}),createQuery:()=>({id:++next}),beginQuery(){},endQuery(){},getParameter:()=>disjoint,
  QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,getQueryParameter:(_,kind)=>kind===3?available:2e6,deleteQuery(){deletes++;}};
 const timer=new BenchmarkGpuTimer(gl),results=[];
 for(let i=0;i<20;i++){timer.begin(1);timer.end();}assert.equal(timer.pendingCount,8);
 timer.poll((run,ms)=>results.push([run,ms]));assert.equal(results.length,0);available=true;timer.poll((run,ms)=>results.push([run,ms]));
 assert.equal(results.length,8);assert.deepEqual(results[0],[1,2]);assert.equal(deletes,8);
 timer.begin(2);timer.end();disjoint=true;timer.poll(()=>assert.fail('disjoint result accepted'));assert.equal(timer.dropped,1);assert.equal(timer.pendingCount,0);
 timer.begin(3);timer.end();timer.dispose();assert.equal(timer.pendingCount,0);
 const unsupported=new BenchmarkGpuTimer({getExtension:()=>null});assert.equal(unsupported.supported,false);unsupported.begin(1);unsupported.end();assert.equal(unsupported.pendingCount,0);
});
