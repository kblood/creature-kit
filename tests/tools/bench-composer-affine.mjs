import {writeFileSync} from 'node:fs';
import {buildComposerSource} from '../../src/fauna-composer-source.ts';
import {composerPreset} from '../../src/fauna-composer-recipe.ts';
import {poseComposer} from '../../src/fauna-composer-rig.ts';
import {FaunaComposerPaletteWriter} from '../../src/fauna-composer-palette.ts';
const source=buildComposerSource(composerPreset('centipede'),{presentation:'realism-1'}),writer=new FaunaComposerPaletteWriter(source.graph),poses=[.17,.31,.57,.79,1.2,1.5].map(t=>poseComposer(source.graph,'walk',t)),out=new Float32Array(source.graph.bones.length*16);
const iterations=10000,run=fast=>{const start=performance.now();for(let i=0;i<iterations;i++)writer.write(poses[i%poses.length],out,0,undefined,fast);return performance.now()-start;};
for(let i=0;i<4;i++){run(false);run(true);}const normal=[],fast=[];for(let i=0;i<10;i++){if(i%2){fast.push(run(true));normal.push(run(false));}else{normal.push(run(false));fast.push(run(true));}}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],report={engine:process.version,bones:source.graph.bones.length,iterationsPerTrial:iterations,trials:10,normalMs:normal,fastMs:fast,normalMedianMs:median(normal),fastMedianMs:median(fast),scope:'bone palette arithmetic only; no renderer or GPU workload'};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2));console.log(JSON.stringify(report));
