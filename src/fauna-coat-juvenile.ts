import {hash3u, evaluateCoat, evaluateCoatWithMask, type CoatGenome, type CoatSample} from './fauna-coat-fields.ts';
import {COAT_MARK_BITS} from './fauna-coat-vocab.ts';
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(lo:number,hi:number,v:number)=>{const t=clamp((v-lo)/(hi-lo),0,1);return t*t*(3-2*t);};
/** Sample-layer semantics shared by the historical planet sampler and Composer.
 * No body generator, actor, material or mutable random stream is involved. */
export const FAUNA_JUVENILE_COAT_VERSION='planet-juvenile-coat-1';
export interface FaunaJuvenileCoatStage {version:typeof FAUNA_JUVENILE_COAT_VERSION;stage:'adult'|'juvenile';maturity:number}
export function faunaJuvenileStockingStrength(maturity:number):number{return mix(.4,1,smooth(.2,.7,maturity));}
const stageCoats=new WeakMap<CoatGenome,{unspotted:CoatGenome;unstocked:CoatGenome}>(),stockOut=new Float64Array(3);
/** Writes the prepared coat plus the shared planetary stage layers. Caller
 * supplies unwarped body coordinates for the fawn rows, independent of pattern
 * phase/lateral offsets. Forced masks are the Composer's existing crisp layers;
 * applying stage layers to all three keeps them visible through that shader. */
export function evaluateFaunaStageCoat(coat:CoatGenome,stage:FaunaJuvenileCoatStage,sample:CoatSample,body:{x:number;y:number;z:number;halfH:number;halfW:number;cell:number},out:Float64Array,mask?:number,patch=0):void{
 const spots=(coat.marks&COAT_MARK_BITS['juvenile-spots'])!==0&&coat.juvenileSpots>0;
 const cacheable=Object.isFrozen(coat);let prepared=cacheable?stageCoats.get(coat):undefined;if(!prepared){const unspotted=spots?{...coat,marks:coat.marks&~COAT_MARK_BITS['juvenile-spots']}:coat;prepared={unspotted,unstocked:{...unspotted,marks:unspotted.marks&~COAT_MARK_BITS.socks}};if(cacheable)stageCoats.set(coat,prepared);}const {unspotted,unstocked}=prepared;
 if(mask===undefined)evaluateCoat(unspotted,sample,out,0);else evaluateCoatWithMask(unspotted,sample,out,0,mask,patch);
 if(stage.stage==='juvenile'&&(unspotted.marks&COAT_MARK_BITS.socks)&&(sample.region==='limb-lower'||sample.region==='foot')){
  const k=faunaJuvenileStockingStrength(stage.maturity);
  if(k<1){if(mask===undefined)evaluateCoat(unstocked,sample,stockOut,0);else evaluateCoatWithMask(unstocked,sample,stockOut,0,mask,patch);for(let c=0;c<3;c++)out[c]=mix(stockOut[c]!,out[c]!,k);}
 }
 if(spots&&(sample.region==='torso'||sample.region==='limb-upper')){
  const k=faunaFawnSpotMask(coat.seed,body.x,body.y,body.z,body.cell,body.halfH,body.halfW),t=.85*coat.juvenileSpots*k;
  if(t>0)for(let c=0;c<3;c++){const cream=FAWN_CREAM[c]!;out[c]=mix(out[c]!,Math.max(mix(coat.colours.belly[c]!,cream,.55),mix(out[c]!,cream,.5)),t);}
 }
}
/** Linear cream of fawn spots (the WP1 juvenile-spot white). */
export const FAWN_CREAM = [.6, .585, .55] as const;
const FAWN_SPOT_CELLS = 2.1, FAWN_DEFAULT_CELL = .024, FAWN_SALT = 0x5a1f7e31, FAWN_JITTER = .1, FAWN_X0 = -.36, FAWN_X1 = .28;
export interface FaunaFawnSpotLayout { radius: number; spacing: number; rowGap: number; rows: readonly number[] }
/** Spot layout in torso lengths for a near body whose vertex cell is
 * `cell` torso lengths. */
export function faunaFawnSpotLayout(cell: number): FaunaFawnSpotLayout {
  const c = cell > 0 ? cell : FAWN_DEFAULT_CELL, radius = Math.max(FAWN_SPOT_CELLS * c, .042);
  // Two neighbouring spots at their largest radius (1 + FAWN_JITTER) and closest
  // jitter still leave a two-cell gap: along a row, between offset rows and
  // across the spine.
  const clear = 2 * (1 + FAWN_JITTER) * radius + 2 * c, spacing = clear / (1 - 2 * FAWN_JITTER);
  const half = .5 * spacing * (1 - 2 * FAWN_JITTER), rowGap = Math.sqrt(Math.max(clear * clear - half * half, 0)) / (1 - 2 * FAWN_JITTER);
  const first = .5 * clear + FAWN_JITTER * rowGap;
  return { radius, spacing, rowGap, rows: [first, first + rowGap, first + 2 * rowGap] };
}
/** Fawn-spot coverage (0..1) at a torso or thigh vertex: x forward of the
 * torso centre, (dy, z) from the torso axis, all in torso lengths; halfH and
 * halfW are the torso's half height and half width. The dorsal row lies along
 * the spine in surface coordinates (arc length from the spine); the two flank
 * rows are laid out in side projection, which stays continuous across the
 * torso/thigh seam, so a flank spot over the hip is painted whole on both. */
let fawnLayoutCell = NaN, fawnLayout: FaunaFawnSpotLayout | undefined;
export function faunaFawnSpotMask(seed: number, x: number, dy: number, z: number, cell: number, halfH: number, halfW: number): number {
  // One body shares one cell size: reuse its layout instead of allocating per vertex.
  if (cell !== fawnLayoutCell || !fawnLayout) { fawnLayoutCell = cell; fawnLayout = faunaFawnSpotLayout(cell); }
  const L = fawnLayout;
  if (x < FAWN_X0 - 2 * L.radius || x > FAWN_X1 + 2 * L.radius) return 0;
  const rLoc = Math.hypot(dy, z), arc = Math.atan2(Math.abs(z), dy) * rLoc, side = z >= 0 ? 1 : 2, e = .6 * (cell > 0 ? cell : FAWN_DEFAULT_CELL);
  const top = halfH * Math.cos(Math.min(L.rows[0]! / Math.max(halfH, 1e-3), Math.PI / 2)), flank = Math.abs(z) >= .4 * halfW;
  let best = 0;
  for (let row = 0; row < 3; row++) {
    // Row 0: arc from the spine; rows 1-2: height in side projection.
    const v0 = row === 0 ? arc : dy, centre = row === 0 ? L.rows[0]! : top - row * L.rowGap, offset = row === 1 ? .5 : row === 2 ? .25 : 0;
    if (row > 0 && !flank) continue;
    if (Math.abs(v0 - centre) > L.rowGap) continue;
    const k = Math.floor(x / L.spacing - offset);
    for (let j = k - 1; j <= k + 1; j++) {
      const h0 = hash3u(j, row, side, seed ^ FAWN_SALT), h1 = hash3u(j, row, side + 4, seed ^ FAWN_SALT);
      if ((h0 & 255) / 256 > (row === 2 ? .45 : .9)) continue; // the lowest row is sparse
      const px = (j + offset + .5 + ((h0 >>> 8 & 255) / 255 - .5) * 2 * FAWN_JITTER) * L.spacing;
      // Whole spots only: a spot is kept or dropped by its centre, never faded.
      if (px < FAWN_X0 || px > FAWN_X1) continue;
      const pv = centre + ((h0 >>> 16 & 255) / 255 - .5) * 2 * FAWN_JITTER * L.rowGap;
      const radius = L.radius * (1 + FAWN_JITTER * (h1 & 255) / 255);
      const v = 1 - smooth(radius - e, radius + e, Math.hypot(x - px, v0 - pv));
      if (v > best) best = v;
    }
  }
  return best;
}

