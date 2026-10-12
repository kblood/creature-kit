export function composerShadowStrength(distance:number,near=35,far=140){
  if(!Number.isFinite(distance)||distance<0||!Number.isFinite(near)||!Number.isFinite(far)||near<0||far<=near)throw new Error('Invalid shadow distance policy');
  const t=Math.max(0,Math.min(1,(distance-near)/(far-near)));return 1-t*t*(3-2*t);
}
/** A stable 4x4 shadow-map dither. Strength 1 preserves every original fragment;
 * strength 0 discards all. PCF filtering smooths intermediate coverage. */
export function patchComposerShadowFade(shader:{vertexShader:string;fragmentShader:string},expression:string){
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vComposerShadowStrength;')
    .replace(/void\s+main\s*\(\s*\)\s*\{/,`void main() {\n vComposerShadowStrength=clamp(${expression},0.0,1.0);`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vComposerShadowStrength;')
    .replace(/void\s+main\s*\(\s*\)\s*\{/,`void main() {\n float composerDither=(mod(floor(gl_FragCoord.x),4.0)+4.0*mod(floor(gl_FragCoord.y),4.0)+0.5)/16.0;\n if(vComposerShadowStrength<composerDither)discard;`);
}
