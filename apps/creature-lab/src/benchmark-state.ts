export type BenchmarkTier='source'|'4500'|'1000';
export interface BenchmarkOptions{count:number;collection:'selected'|'mixed';placement:'distances'|'near';lod:'auto'|BenchmarkTier;instancing:boolean;atlasRenderer:boolean;partialUploads:boolean;adaptiveAnimation:boolean;reuseWorkingBuffers:boolean;fastFarMatrices:boolean;distanceShadows:boolean;shareGeometry:boolean;sharePose:boolean;culling:boolean;shadows:boolean;animate:boolean;stride:number}
export interface BenchmarkMember{id:number;source:number;position:[number,number,number]}
export const BENCHMARK_PRESETS=['dinosaur','turtle','worm','centipede','giraffe','bird'] as const;
export function benchmarkMembers(options:BenchmarkOptions):BenchmarkMember[]{
 if(![16,64,128,256].includes(options.count))throw new Error('Unsupported population size');
 return Array.from({length:options.count},(_,id)=>{
  const group=options.placement==='distances'?id%3:0,index=options.placement==='distances'?Math.floor(id/3):id;
  const members=options.placement==='distances'?Math.ceil((options.count-group)/3):options.count;
  const columns=Math.ceil(Math.sqrt(members)),spacing=group===0?2.6:group===1?5:8;
  const distance=options.placement==='distances'?[10,80,220][group]!:15;
  return {id,source:options.collection==='mixed'?Math.floor(id/3)%BENCHMARK_PRESETS.length:0,
   position:[((index%columns)-(columns-1)/2)*spacing,0,12-distance-Math.floor(index/columns)*spacing]};
 });
}
export function benchmarkTier(distance:number,forced:BenchmarkOptions['lod'],previous?:BenchmarkTier):BenchmarkTier{
 if(forced!=='auto')return forced;
 if(previous==='source'&&distance<38.5)return 'source';
 if(previous==='1000'&&distance>126)return '1000';
 if(previous==='4500'&&distance>=31.5&&distance<=154)return '4500';
 return distance<35?'source':distance<140?'4500':'1000';
}
export function sampleStats(samples:readonly number[]){
 if(!samples.length)return null;
 if(samples.some(n=>!Number.isFinite(n)||n<0))throw new Error('Invalid timing sample');
 const sorted=[...samples].sort((a,b)=>a-b),percentile=(p:number)=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]!;
 return {samples:sorted.length,mean:samples.reduce((a,b)=>a+b,0)/samples.length,median:percentile(.5),p95:percentile(.95),p99:percentile(.99),min:sorted[0]!,max:sorted.at(-1)!};
}
