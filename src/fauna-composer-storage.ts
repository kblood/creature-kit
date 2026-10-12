import type {FaunaComposerRenderSkin} from './fauna-composer-render-source.ts';

export const COMPOSER_PACKED_STORAGE_VERSION = 'composer-arena-packed-1';
export const COMPOSER_GPU_STORAGE_VERSION = 'composer-gpu-arena-1';
export type FaunaComposerArenaStorage = 'float-1'|'packed-1';
export type ComposerStoredArray = Float32Array|Int16Array|Uint16Array|Uint8Array;
export interface ComposerQuantizationProof {
  version: 'composer-quantization-proof-1'; vertices: number; checkedVertices: number;
  maxNormalError: number; maxColourError: number; maxWeightError: number; maxGlossError: number;
  maxWeightSumError: number;
  /** Position, noise sample coordinates, joints, local indices and sourceVertex
   * are exact. Only the explicitly listed normalized attributes are quantized. */
  exact: readonly ['positions','coatSample','skinIndex','index','sourceVertex'];
}
export type FaunaComposerPackedSkin = Omit<FaunaComposerRenderSkin, 'normals'|'colors'|'skinIndex'|'skinWeight'|'gloss'|'coatLayers'|'index'|'sourceVertex'> & {
  storage: {version: typeof COMPOSER_PACKED_STORAGE_VERSION; proof: ComposerQuantizationProof;
    localIndexType:'uint16'|'uint32';sourceVertexType:'uint16'|'uint32'|null;
    readback?:'webgl2-getBufferSubData';sourceOwnership?:typeof COMPOSER_GPU_STORAGE_VERSION};
  normals: Int16Array; colors: Uint16Array; skinIndex: Uint8Array; skinWeight: Uint16Array; gloss: Uint8Array;
  coatLayers: null|{c0:Uint16Array;c1:Uint16Array;c2:Uint16Array;sample:Float32Array};
  index:Uint16Array|Uint32Array;sourceVertex:Uint16Array|Uint32Array|null;
};
/** An explicit GPU allocation receipt, never a pretend array of raw floats.
 * Original LOD lookup metadata remains exact and source reconstruction is pure. */
export type FaunaComposerGpuSkin = Pick<FaunaComposerPackedSkin,'version'|'index'|'sourceVertex'|'coatCrisp'> & {
  vertexCount:number;hasCoatLayers:boolean;
  storage:{version:typeof COMPOSER_GPU_STORAGE_VERSION;format:typeof COMPOSER_PACKED_STORAGE_VERSION;proof:ComposerQuantizationProof;
    localIndexType:'uint16'|'uint32';sourceVertexType:'uint16'|'uint32'|null};
};
export type FaunaComposerStoredSkin = FaunaComposerRenderSkin|FaunaComposerPackedSkin|FaunaComposerGpuSkin;
export function isGpuComposerSkin(skin:FaunaComposerStoredSkin):skin is FaunaComposerGpuSkin {
  return 'storage' in skin&&skin.storage?.version===COMPOSER_GPU_STORAGE_VERSION;
}
export function composerStoredVertices(skin:FaunaComposerStoredSkin):number{return isGpuComposerSkin(skin)?skin.vertexCount:skin.positions.length/3;}
export function isPackedComposerSkin(skin: FaunaComposerStoredSkin): skin is FaunaComposerPackedSkin {
  return 'storage' in skin && skin.storage?.version === COMPOSER_PACKED_STORAGE_VERSION;
}
/** Exact retained lookup metadata, not geometry quantization. The original
 * source/reducer arrays and the arena's global Uint32 GPU index stay untouched. */
export function compactComposerIndices(source:Uint16Array|Uint32Array):Uint16Array|Uint32Array {
  if(source instanceof Uint16Array)return source;
  for(const value of source)if(value>65535)return source;
  return new Uint16Array(source);
}
export function composerQuantizationProof(vertices: number): ComposerQuantizationProof {
  return {version:'composer-quantization-proof-1',vertices,checkedVertices:0,maxNormalError:0,maxColourError:0,maxWeightError:0,maxGlossError:0,maxWeightSumError:0,
    exact:['positions','coatSample','skinIndex','index','sourceVertex']};
}
export function composerStorageCodec(name: string): {scale: number; signed: boolean; range: number} | null {
  if (name === 'normal') return {scale:32767,signed:true,range:1};
  if (['color','coatL0','coatL1','coatL2'].includes(name)) return {scale:65535,signed:false,range:2};
  if(name==='skinWeight')return {scale:65535,signed:false,range:1};
  if (name === 'composerGloss') return {scale:255,signed:false,range:1};
  return null;
}
/** Decode matches normalized WebGL attributes; packed weights are subsequently
 * divided by their per-vertex sum in every skinning shader. */
export function decodedComposerAttribute(array: ComposerStoredArray, index: number, name: string, packed: boolean): number {
  const codec = packed ? composerStorageCodec(name) : null;
  return codec ? Math.max(codec.signed ? -1 : 0, array[index]! / codec.scale * codec.range) : array[index]!;
}
/** Independent full proof for tests/offline review. Runtime admission collects
 * the same error bounds while copying bounded vertex slices. */
export function validatePackedComposerSkin(source: FaunaComposerRenderSkin, packed: FaunaComposerPackedSkin): ComposerQuantizationProof {
  const vertices = source.positions.length / 3, proof = composerQuantizationProof(vertices);
  if (packed.storage.version !== COMPOSER_PACKED_STORAGE_VERSION || packed.version !== source.version || packed.positions.length !== source.positions.length || packed.index.length !== source.index.length ||
      !!source.sourceVertex !== !!packed.sourceVertex || JSON.stringify(source.coatCrisp)!==JSON.stringify(packed.coatCrisp)) throw new Error('Packed Composer identity shape mismatch');
  const exact = (a: ArrayLike<number>, b: ArrayLike<number>) => {if(a.length!==b.length)throw new Error('Packed Composer exact attribute length');for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))throw new Error('Packed Composer exact attribute changed');};
  exact(source.positions,packed.positions);exact(source.skinIndex,packed.skinIndex);exact(source.index,packed.index);
  if (source.sourceVertex) {if(!packed.sourceVertex)throw new Error('Packed Composer source map missing');exact(source.sourceVertex,packed.sourceVertex);}
  if (!!source.coatLayers !== !!packed.coatLayers) throw new Error('Packed Composer coat layers changed');
  if(source.coatLayers&&packed.coatLayers)exact(source.coatLayers.sample,packed.coatLayers.sample);
  const compare=(a:Float32Array,b:ComposerStoredArray,name:string)=>{if(a.length!==b.length)throw new Error('Packed Composer attribute length');let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]!-decodedComposerAttribute(b,i,name,true)));return max;};
  proof.maxNormalError=compare(source.normals,packed.normals,'normal');proof.maxColourError=compare(source.colors,packed.colors,'color');proof.maxGlossError=compare(source.gloss,packed.gloss,'composerGloss');
  if(source.coatLayers&&packed.coatLayers)for(const key of ['c0','c1','c2'] as const)proof.maxColourError=Math.max(proof.maxColourError,compare(source.coatLayers[key],packed.coatLayers[key],'color'));
  for(let v=0;v<vertices;v++){let sum=0;for(let k=0;k<4;k++)sum+=packed.skinWeight[v*4+k]!/65535;
    if(sum<=0)throw new Error('Packed Composer zero weight sum');proof.maxWeightSumError=Math.max(proof.maxWeightSumError,Math.abs(sum-1));
    for(let k=0;k<4;k++)proof.maxWeightError=Math.max(proof.maxWeightError,Math.abs(source.skinWeight[v*4+k]!-packed.skinWeight[v*4+k]!/65535/sum));}
  proof.checkedVertices=vertices;assertComposerQuantizationProof(proof);return proof;
}
export function assertComposerQuantizationProof(proof: ComposerQuantizationProof): void {
  if(proof.checkedVertices!==proof.vertices || !Number.isFinite(proof.maxNormalError+proof.maxColourError+proof.maxWeightError+proof.maxGlossError+proof.maxWeightSumError) ||
    proof.maxNormalError>1/65534+1e-7 || proof.maxColourError>1/65535+1e-7 || proof.maxGlossError>1/510+1e-7 || proof.maxWeightError>4/65535+1e-7 || proof.maxWeightSumError>2/65535+1e-7) throw new Error('Packed Composer quantization proof exceeds its bounds');
}
