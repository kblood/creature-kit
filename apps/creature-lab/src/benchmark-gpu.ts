type TimerExt={TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number};
/** Asynchronous, bounded timer queries. Never finish()/readPixels() in a timed frame. */
export class BenchmarkGpuTimer{
 private readonly ext:TimerExt|null;
 private pending:{query:WebGLQuery;run:number}[]=[];
 private active:{query:WebGLQuery;run:number}|null=null;
 dropped=0;
 private gl:WebGL2RenderingContext;
 constructor(gl:WebGL2RenderingContext){this.gl=gl;this.ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');}
 get supported(){return !!this.ext;}
 get pendingCount(){return this.pending.length;}
 begin(run:number){if(!this.ext||this.pending.length>=8||this.active)return;const query=this.gl.createQuery();if(!query)return;this.active={query,run};this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT,query);}
 end(){if(!this.active||!this.ext)return;this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.pending.push(this.active);this.active=null;}
 poll(accept:(run:number,ms:number)=>void){
  if(!this.ext)return;
  if(this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)){this.dropped+=this.pending.length;this.clear();return;}
  while(this.pending.length&&this.gl.getQueryParameter(this.pending[0]!.query,this.gl.QUERY_RESULT_AVAILABLE)){
   const item=this.pending.shift()!,ns=this.gl.getQueryParameter(item.query,this.gl.QUERY_RESULT);this.gl.deleteQuery(item.query);
   if(Number.isFinite(ns)&&ns>=0)accept(item.run,ns/1e6);else this.dropped++;
  }
 }
 clear(){if(this.active)this.end();for(const item of this.pending)this.gl.deleteQuery(item.query);this.pending=[];}
 dispose(){this.clear();}
}
