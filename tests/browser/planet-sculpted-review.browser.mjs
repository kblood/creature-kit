import {createServer} from 'vite';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {withGpuLock} from '../helpers/gpu-lock.mjs';
const out=process.env.QUALITY_RESULTS,atlas=process.env.ATLAS_ROOT;if(!out||!atlas)throw new Error('QUALITY_RESULTS and ATLAS_ROOT required');
const {chromium}=await import(pathToFileURL(atlas+'/node_modules/playwright/index.mjs'));
const server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:5364,strictPort:true,fs:{allow:['C:/LLM/IWSDK']}}});await server.listen();
const report={errors:[],images:[]};await mkdir(out+'/visual',{recursive:true});
try{await withGpuLock({owner:'sculpted planetary body paired review',retryMs:30000},async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu']});
  try{const page=await browser.newPage({viewport:{width:1600,height:938}});page.on('pageerror',e=>report.errors.push(String(e)));
    await page.goto('http://127.0.0.1:5364/tests/browser/planet-sculpted-review.html?data='+encodeURIComponent('/@fs/'+out));await page.waitForFunction(()=>window.__qualityReview?.ready);
    const rows=process.env.QUALITY_ROWS?JSON.parse(process.env.QUALITY_ROWS):[0,1,2,3,4,5,6,7,8,9];
    for(const i of rows)for(const pose of ['rest','walk','feed'])for(const view of ['side','front','head']){
      const neutral=view!=='head';const info=await page.evaluate(({i,pose,view,neutral})=>window.__qualityReview.review(i,pose,view,neutral),{i,pose,view,neutral});
      const file=`${i}-${pose}-${view}.png`;await page.screenshot({path:out+'/visual/'+file});report.images.push({...info,file});
    }
    report.ok=report.errors.length===0;
  }finally{await browser.close();}
});}finally{await server.close();await writeFile(out+'/visual/report.json',JSON.stringify(report,null,2));}
if(!report.ok)throw new Error(JSON.stringify(report.errors));console.log(JSON.stringify({ok:true,images:report.images.length}));
