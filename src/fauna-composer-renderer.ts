import * as THREE from 'three';
import {COMPOSER_BUDGET, type ComposerGraph, type ComposerPose} from './fauna-composer-rig.ts';
import {FaunaComposerPaletteWriter} from './fauna-composer-palette.ts';
import {ComposerPaletteUploads} from './fauna-composer-palette-uploads.ts';
import {ComposerTemporalPose,composerActiveBones} from './fauna-composer-animation.ts';
import {composerShadowStrength} from './fauna-composer-shadows.ts';
import {FaunaComposerInstanceBatch, FAUNA_COMPOSER_REQUIRED_ATTRIBUTES} from './fauna-composer-instance-batch.ts';
import {FaunaComposerMergedBatch} from './fauna-composer-merged-batch.ts';
import {isPackedComposerSkin, isGpuComposerSkin, type FaunaComposerStoredSkin, type FaunaComposerArenaStorage} from './fauna-composer-storage.ts';
import {canonicalComposerJson, composerContentDigest, freezeComposerDefinition, isVerifiedComposerBuild} from './fauna-composer-build-receipt.ts';
import {FAUNA_COMPOSER_TIERS, FAUNA_COMPOSER_RENDER_VERSION, composerTypedBytes, validateComposerRenderSkin, validateComposerRenderLod,
  type FaunaComposerSource, type FaunaComposerSourceProvider, type FaunaComposerBuildResult, type FaunaComposerRenderSkin, type FaunaComposerTier} from './fauna-composer-render-source.ts';

export interface FaunaComposerCandidate<D> {
  id: string; definition: D; sourceKey: string;
  /** Optional shared immutable identity text from the actual source provider.
   * Validated before reuse; its bytes remain included in resident accounting. */
  canonicalDefinition?: string;
  /** Metre-space body to radius-normalized origin-relative world. +X is forward. */
  matrix: THREE.Matrix4; distanceM: number; cameraVisible: boolean; shadowVisible?: boolean;
  rigSeconds: number;
  /** Include date, ground revision, activity and every pose option, or omit to evaluate each frame. */
  poseKey?: string;
  /** Stable across continuous clock advancement; changes on terrain/activity/date discontinuities. */
  animationContext?:string;
  /** Real camera distance when a benchmark forces a different geometric tier. */
  presentationDistanceM?:number;
}
export interface FaunaComposerRendererOptions<D, C extends FaunaComposerCandidate<D>> {
  provider: FaunaComposerSourceProvider<D>;
  /** Shared Kit Composer solver, including its terrain/flight options. Never a quadruped retarget. */
  pose: (graph: ComposerGraph, candidate: C,reuseWorkingBuffers?:boolean) => ComposerPose;
  /** Attach the planet's lighting/aerial/shadow hooks to this owned mesh once. */
  onMeshAdopted?: (mesh: THREE.Mesh) => void;
  /** Optional WebGL2-owned packed arenas. Full CPU attribute mirrors are absent;
   * only explicit snapshotOf inspection performs readback. */
  mergedGpuContext?:WebGL2RenderingContext;
  /** Explicitly sized arenas: unique reduced animals share one draw per tier.
   * Arena CPU+GPU allocations count against maxBytes before accepting sources. */
  mergedTiers?: Partial<Record<'middle'|'far', {maxVertices: number; maxIndices: number; maxBytes: number; storage?: FaunaComposerArenaStorage; activeIndexPasses?:boolean}>>;
  capacity?: number; maxSources?: number; maxBones?: number; maxBytes?: number; maxResultBytes?: number;
  workerReserveBytes?: number; maxDistanceM?: number; nearM?: number; middleM?: number;
  fullSourceCache?: number; adoptionBudgetMs?: number; now?: () => number; onReady?: () => void;
  /** Bounded unique middle sources, prioritized by the caller's stable order.
   * Other members retain their source-derived far tier, with no unfulfillable upgrade. */
  middleSourceCache?: number;
  /** Interleave one retained-original near upgrade after this many cold jobs.
   * Omitted preserves strict coarse-first scheduling for component consumers. */
  coldJobsBeforeNearUpgrade?: number;
  /** Dirty RGBA row uploads; false retains the full-upload reference path. */
  partialPaletteUploads?: boolean;
  adaptiveAnimation?:boolean;
  reuseWorkingBuffers?:boolean;
  fastFarMatrices?:boolean;
  distanceShadows?:boolean;
  shadowNearM?:number;shadowFarM?:number;
}
type Entry = {source: FaunaComposerSource | null; graph: ComposerGraph; levels: Partial<Record<FaunaComposerTier, FaunaComposerStoredSkin>>;
  batches: Partial<Record<FaunaComposerTier, FaunaComposerInstanceBatch>>; writer: FaunaComposerPaletteWriter;
  activeBones:Partial<Record<FaunaComposerTier,Uint16Array>>;
  definition: string; graphIdentity: string; skinIdentity: string; graphBytes: number; used: number; cpuBytes: number;
  /** Retain measured size after discarding an unused tier, preventing budget retry loops. */
  middleFootprint?: {vertices: number; indices: number}};
type Actor = {key: string; row: number; poseKey?: string; tier?: FaunaComposerTier; pose: ComposerPose | null; poseBytes: number; temporal?:ComposerTemporalPose;lastClock?:number};
type MergedTier = 'middle'|'far';
type Running = {key: string; definition: string; definitionRef: unknown; tiers: readonly FaunaComposerTier[]; epoch: number; abort: AbortController};
type Prepared = {run: Running; source: FaunaComposerSource | null; graph: ComposerGraph; graphIdentity: string; skinIdentity: string; graphBytes: number;
  levels: Partial<Record<FaunaComposerTier, FaunaComposerRenderSkin>>; activeBones:Partial<Record<FaunaComposerTier,Uint16Array>>;writer: FaunaComposerPaletteWriter; bytes: number; buildMs: number; attempt: number};
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
function sourceRoughness(graph: ComposerGraph): number {return (graph as ComposerGraph & {phenotype?: {roughness: number}}).phenotype?.roughness ?? .82;}

/** Normal-runtime Composer draw owner. All tiers come from one immutable source;
 * a pending or failed upgrade continues to draw a resident tier. Cold animals
 * remain explicitly pending until their actual source arrives. No proxy body,
 * secondary generator, fixed rig or altitude-dependent representation exists.
 *
 * Call with camera-first, distance/id-stable candidates. One asynchronous build
 * and one bounded result adoption may be active. Object and buffer lifetimes
 * follow source eviction/context reset; CPU and GPU copies are counted separately. */
export class FaunaComposerRenderer<D, C extends FaunaComposerCandidate<D> = FaunaComposerCandidate<D>> {
  readonly group = new THREE.Group();
  readonly capacity: number;
  readonly maxBones: number;
  readonly workerReserveBytes: number;
  private readonly options: FaunaComposerRendererOptions<D, C>;
  private readonly entries = new Map<string, Entry>();
  private readonly actors = new Map<string, Actor>();
  private readonly failed = new Map<string, number>();
  private readonly desired = new Map<string, C>();
  private readonly members = new Map<string, C[]>();
  private readonly frameSourceKeys=new Set<string>();
  private readonly priorSourceKeys=new Set<string>();
  private actorRows=new Uint8Array(0);
  private readonly identities = new WeakMap<object, string>();
  private readonly ready = new Map<string, Prepared>();
  private readonly blocked = new Map<string, {bytes: number; extra: boolean; revision: number}>();
  private readonly fullSourceKeys = new Set<string>();
  private readonly middleSourceKeys = new Set<string>();
  private readonly merged = new Map<'middle'|'far', FaunaComposerMergedBatch>();
  /** Far remains resident while a nearer tier draws. Each arena independently
   * hides all rows at beginFrame; only the selected tier is submitted. */
  private readonly mergedBindings = new Map<string, Partial<Record<MergedTier,string>>>();
  private readonly levelOwners = new Map<string, string>();
  private readonly arenaBuffers = new Set<ArrayBufferLike>();
  private paletteData: Float32Array;
  private scratch: Float32Array;
  private readonly paletteUniform: {value: THREE.DataTexture};
  private readonly paletteUploads:ComposerPaletteUploads;
  private paletteBones: number;
  private readonly drawn = new Set<string>();
  private running: Running | null = null;
  private revision = 0;
  private frame = 0; private epoch = 0; private context = ''; private disposed = false;
  private coldJobs = 0;
  private readonly maxSources: number; private readonly maxBytes: number; private readonly maxResultBytes: number;
  private readonly now: () => number;
  private stats = {builds: 0, failures: 0, evictions: 0, stale: 0, budgetDrops: 0, pending: 0, poseFailures: 0,
    buildMs: 0, adoptionMs: 0, adoptionOverruns: 0, preparationMs: 0, geometryCopyMs: 0, copySliceMaxMs: 0, verificationOnMain: 0, completedOutOfView: 0,
    stagedEvictions: 0, blockedAdmissions: 0, upgradesPending: 0, active: 0, draws: 0, triangles: 0, poseBuilds: 0,temporalSamples:0,temporalFrames:0,temporalBudgetFallbacks:0,boneMatricesWritten:0,boneMatricesAvailable:0,fastBoneMatrices:0,uploadBytes: 0};
  private lastError: string | null = null;
  private contextLost=false;
  private readonly onContextLost=(event:Event)=>{event.preventDefault();this.contextLost=true;this.group.visible=false;this.setContext(this.context,true);for(const batch of this.merged.values())batch.loseContext();};
  private readonly onContextRestored=()=>{if(this.disposed)return;for(const batch of this.merged.values())batch.restoreContext();
    // GPU storage is new even when CPU palette width/data did not change.
    this.paletteUploads.attach(this.paletteUniform.value);this.paletteUniform.value.needsUpdate=true;
    this.contextLost=false;this.group.visible=true;this.options.onReady?.();};

  constructor(options: FaunaComposerRendererOptions<D, C>) {
    this.options = options; this.capacity = options.capacity ?? 512; this.maxBones = options.maxBones ?? COMPOSER_BUDGET.maxBones;
    this.maxSources = options.maxSources ?? 512; this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    this.maxResultBytes = options.maxResultBytes ?? 8 * 1024 * 1024; this.workerReserveBytes = options.workerReserveBytes ?? 16 * 1024 * 1024;
    this.now = options.now ?? (() => performance.now());
    if (options.coldJobsBeforeNearUpgrade !== undefined && !positive(options.coldJobsBeforeNearUpgrade)) throw new Error('Invalid Composer cold job interval');
    if (options.middleSourceCache !== undefined && (!Number.isSafeInteger(options.middleSourceCache) || options.middleSourceCache < 0 || options.middleSourceCache > this.maxSources)) throw new Error('Invalid Composer middle source limit');
    if (![this.capacity, this.maxBones, this.maxSources, this.maxBytes, this.maxResultBytes, this.workerReserveBytes].every(positive) ||
        this.capacity > 512 || this.maxBones > COMPOSER_BUDGET.maxBones || this.maxSources > 512 ||
        (options.nearM ?? 35) <= 0 || (options.middleM ?? 140) <= (options.nearM ?? 35) ||
        (options.maxDistanceM ?? 600) < (options.middleM ?? 140) || (options.adoptionBudgetMs ?? 3) <= 0) throw new Error('Invalid Composer renderer budgets');
    this.actorRows=new Uint8Array(this.capacity);
    this.paletteUploads=new ComposerPaletteUploads(this.capacity,options.partialPaletteUploads??false);
    this.paletteBones = Math.min(16, this.maxBones);
    this.paletteData = new Float32Array(this.capacity * this.paletteBones * 16); this.scratch = new Float32Array(this.maxBones * 16);
    this.paletteUniform = {value: this.makePalette()};
    this.paletteUploads.attach(this.paletteUniform.value);
    if (this.ownedBytes > this.maxBytes) {this.paletteUniform.value.dispose(); throw new Error('Composer palette exceeds resident budget');}
    try {for (const tier of ['middle', 'far'] as const) {
      const budget = options.mergedTiers?.[tier]; if (!budget) continue;
      const batch = new FaunaComposerMergedBatch({...budget, gpuContext:options.mergedGpuContext,maxActors: this.capacity, bones: this.paletteUniform});
      this.merged.set(tier, batch);
      for (const buffer of batch.backingBuffers) this.arenaBuffers.add(buffer);
      if (this.ownedBytes > this.maxBytes) throw new Error('Composer merged arenas exceed resident budget');
      // Both mesh types use the same world lighting hooks; ownership stays here.
      options.onMeshAdopted?.(batch.mesh); this.group.add(batch.mesh);
    }} catch (error) {for (const b of this.merged.values()) b.dispose(); this.paletteUniform.value.dispose(); throw error;}
    this.group.name = 'Planet Composer animals'; this.group.userData.version = FAUNA_COMPOSER_RENDER_VERSION;
    options.mergedGpuContext?.canvas.addEventListener('webglcontextlost',this.onContextLost);
    options.mergedGpuContext?.canvas.addEventListener('webglcontextrestored',this.onContextRestored);
  }
  private makePalette(): THREE.DataTexture {
    const texture = new THREE.DataTexture(this.paletteData, this.paletteBones * 4, this.capacity, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.generateMipmaps = false;
    texture.internalFormat = 'RGBA32F'; texture.needsUpdate = true; return texture;
  }
  setViewCameras(cameras:readonly THREE.Camera[]):void {for(const batch of this.merged.values())batch.setViewCameras(cameras);}
  private resizePalette(bones: number): void {
    const old = this.paletteData, width = this.paletteBones;
    this.paletteBones = bones; this.paletteData = new Float32Array(this.capacity * bones * 16);
    for (let row = 0; row < this.capacity; row++) this.paletteData.set(old.subarray(row * width * 16, row * width * 16 + Math.min(width, bones) * 16), row * bones * 16);
    this.paletteUniform.value.dispose(); this.paletteUniform.value = this.makePalette();
    this.paletteUploads.attach(this.paletteUniform.value);
  }
  /** Fail before rendering on unsupported devices; 15 slots include full crisp coat and matrix instancing. */
  assertCapabilities(renderer: THREE.WebGLRenderer): void {
    const c = renderer.capabilities;
    if (c.maxAttributes < FAUNA_COMPOSER_REQUIRED_ATTRIBUTES || c.maxVertexTextures < 1 ||
        c.maxTextureSize < Math.max(this.maxBones * 4, this.capacity)) throw new Error('Planet Composer requires variable bone textures and 15 vertex attributes');
  }
  setContext(context: string,forceReset=false): void {
    if (context === this.context&&!forceReset) return; this.context = context; this.epoch++;
    this.coldJobs = 0;
    this.fullSourceKeys.clear(); this.middleSourceKeys.clear();
    this.running?.abort.abort();this.running=null; this.ready.clear(); this.blocked.clear(); this.desired.clear(); this.members.clear(); this.frameSourceKeys.clear();this.priorSourceKeys.clear();this.actorRows.fill(0);this.drawn.clear(); this.actors.clear(); this.failed.clear(); this.revision++;
    for (const id of this.mergedBindings.keys()) this.releaseMerged(id);
    for (const key of this.entries.keys()) this.evict(key);
    for(const batch of this.merged.values())batch.reset();
    this.stats.active=0;this.stats.draws=0;this.stats.triangles=0;
    this.resizePalette(Math.min(16, this.maxBones));
  }
  private shadowStrength(c:C,graph?:ComposerGraph){
    if(!this.options.distanceShadows||!graph)return 1;
    const scale=Math.max(1,Math.max(graph.dims.bodyLength,graph.dims.legReach*2)/4);
    return composerShadowStrength(c.presentationDistanceM??c.distanceM,(this.options.shadowNearM??35)*scale,(this.options.shadowFarM??140)*scale);
  }
  update(candidates: readonly C[], origin?: THREE.Vector3): ReadonlySet<string> {
    this.drawn.clear(); if (this.disposed||this.contextLost) return this.drawn;
    if (origin) this.group.position.copy(origin);
    this.frame++;const priorKeys=this.options.reuseWorkingBuffers===false?new Set(this.members.keys()):this.priorSourceKeys;if(this.options.reuseWorkingBuffers!==false){priorKeys.clear();for(const key of this.members.keys())priorKeys.add(key);}
    this.desired.clear();if(this.options.reuseWorkingBuffers===false)this.members.clear();else for(const group of this.members.values())group.length=0;this.stats.budgetDrops=0;this.stats.pending=0;
    const keys=this.options.reuseWorkingBuffers===false?new Set<string>():this.frameSourceKeys;keys.clear();
    for (const c of candidates) {
      if ((!c.cameraVisible && !c.shadowVisible) || !c.id || !c.sourceKey || !Number.isFinite(c.distanceM) || c.distanceM < 0 || c.distanceM > (this.options.maxDistanceM ?? 600) || this.desired.has(c.id)) continue;
      if(!c.cameraVisible&&this.shadowStrength(c,this.entries.get(c.sourceKey)?.graph)===0)continue;
      if (this.desired.size >= this.capacity) {this.stats.budgetDrops++; continue;}
      this.desired.set(c.id, c); keys.add(c.sourceKey);
      let members = this.members.get(c.sourceKey); if (!members) {members = []; this.members.set(c.sourceKey, members);} members.push(c);
    }
    for(const key of this.members.keys())if(!keys.has(key))this.members.delete(key);
    let changed=keys.size!==priorKeys.size;if(!changed)for(const key of keys)if(!priorKeys.has(key)){changed=true;break;}if(changed)this.revision++;
    this.fullSourceKeys.clear();
    for (const c of this.desired.values()) if (c.distanceM < (this.options.nearM ?? 35) * 1.1 && this.fullSourceKeys.size < (this.options.fullSourceCache ?? 6)) this.fullSourceKeys.add(c.sourceKey);
    this.middleSourceKeys.clear();
    let middleVertices = 0, middleIndices = 0;
    const middleArena = this.options.middleSourceCache === undefined ? undefined : this.options.mergedTiers?.middle;
    for (const c of this.desired.values()) {
      const tier = this.tier(c.distanceM, this.actors.get(c.id)?.tier);
      if (tier === 'far' || tier === 'near' && this.fullSourceKeys.has(c.sourceKey)) continue;
      if (this.middleSourceKeys.has(c.sourceKey) || this.middleSourceKeys.size >= (this.options.middleSourceCache ?? this.maxSources)) continue;
      const footprint = this.entries.get(c.sourceKey)?.middleFootprint;
      const instances = this.members.get(c.sourceKey)!.filter(m => {
        const t = this.tier(m.distanceM, this.actors.get(m.id)?.tier);
        return t !== 'far' && !(t === 'near' && this.fullSourceKeys.has(m.sourceKey));
      }).length;
      const vertices = (footprint?.vertices ?? 0) * instances, indices = (footprint?.indices ?? 0) * instances;
      if (middleArena && (middleVertices + vertices > middleArena.maxVertices || middleIndices + indices > middleArena.maxIndices)) continue;
      this.middleSourceKeys.add(c.sourceKey); middleVertices += vertices; middleIndices += indices;
    }
    this.trimFullSources(); this.adoptPending(keys);
    // Free demoted middle slots before admitting the new priority order. The
    // retained far allocation is already complete, so no worker or copy waits.
    for(const [id,binding] of this.mergedBindings){
      const c=this.desired.get(id),actor=this.actors.get(id);
      if(c&&binding.middle&&binding.far&&this.candidateTier(c,actor?.tier)==='far')this.releaseMerged(id,'middle');
    }
    for (const entry of this.entries.values()) for (const batch of Object.values(entry.batches)) batch.beginFrame();
    for (const batch of this.merged.values()) batch.beginFrame();
    for (const [id, actor] of this.actors) if (this.desired.has(id) && this.desired.get(id)!.sourceKey !== actor.key) {this.releaseMerged(id); this.actors.delete(id);}
    const rows=this.options.reuseWorkingBuffers===false?new Uint8Array(this.capacity):this.actorRows;rows.fill(0);for(const actor of this.actors.values())rows[actor.row]=1;
    this.stats.geometryCopyMs = 0;
    const copy = (pool: FaunaComposerMergedBatch, id: string, skin: FaunaComposerStoredSkin, row: number, roughness: number) => {
      const start = this.now(), deadline = start + Math.max(0, (this.options.adoptionBudgetMs ?? 3) - this.stats.adoptionMs - this.stats.geometryCopyMs);
      let status: 'ready'|'pending'|'full';
      try {status = pool.registerSlice(id, skin, row, roughness, deadline, this.now);}
      catch(error) {pool.release(id);this.lastError=String(error);this.stats.failures++;status='full';}
      const elapsed = this.now() - start; this.stats.geometryCopyMs += elapsed; this.stats.copySliceMaxMs = Math.max(this.stats.copySliceMaxMs, elapsed); return status;
    };
    this.stats.active = 0; this.stats.draws = 0; this.stats.triangles = 0; this.stats.uploadBytes = 0;this.stats.boneMatricesWritten=0;this.stats.boneMatricesAvailable=0;this.stats.fastBoneMatrices=0;
    for (const c of this.desired.values()) {
      const entry = this.entries.get(c.sourceKey);
      if (!entry) {this.stats.pending++; continue;}
      // Detect accidental key reuse instead of replacing another phenotype under the same cache key.
      if (entry.definition !== this.identity(c.definition, true, c.canonicalDefinition)) {this.lastError = 'Composer source key reused for a different definition'; this.stats.failures++; continue;}
      entry.used = this.frame;
      let actor = this.actors.get(c.id);
      const wanted = this.candidateTier(c, actor?.tier);
      const choices = [...new Set([wanted, ...(actor?.tier ? [actor.tier] : []), ...FAUNA_COMPOSER_TIERS])].filter(t => entry.levels[t]);
      if (!choices.length) {this.stats.pending++; continue;}
      if (!actor) {
        if (this.actors.size >= this.capacity) {
          const victim = [...this.actors].filter(([id]) => !this.desired.has(id)).sort((a, b) => (this.entries.get(a[1].key)?.used ?? 0) - (this.entries.get(b[1].key)?.used ?? 0))[0];
          if (!victim) {this.stats.budgetDrops++; continue;} this.releaseMerged(victim[0]);rows[victim[1].row]=0;this.actors.delete(victim[0]);
        }
        let row=0;while(rows[row])row++;rows[row]=1;actor = {key: c.sourceKey, row, pose: null, poseBytes: 0}; this.actors.set(c.id, actor);
      }
      let available: FaunaComposerTier | undefined, batch: FaunaComposerInstanceBatch | null = null, mergedBatch: FaunaComposerMergedBatch | undefined;
      for (const tier of choices) {
        const pool = tier === 'near' ? undefined : this.merged.get(tier);
        if (pool) {
          const mergedTier=tier as MergedTier,binding = this.mergedBindings.get(c.id)?.[mergedTier];
          if (binding === c.sourceKey) {mergedBatch = pool; available = tier; break;}
          if (binding) this.releaseMerged(c.id,mergedTier);
          let status = copy(pool, c.id, entry.levels[tier]!, actor.row, sourceRoughness(entry.graph));
          if (status === 'full') {
            const owners=new Set([...this.mergedBindings.values()].flatMap(b=>b[mergedTier]?[b[mergedTier]!]:[]));
            const victim = [...this.entries].filter(([key]) => !keys.has(key)&&owners.has(key)).sort((a, b) => a[1].used - b[1].used)[0];
            if (victim) {this.evict(victim[0]); status = copy(pool, c.id, entry.levels[tier]!, actor.row, sourceRoughness(entry.graph));}
          }
          if (status !== 'ready') continue;
          const bindings=this.mergedBindings.get(c.id)??{};bindings[mergedTier]=c.sourceKey;this.mergedBindings.set(c.id,bindings);
          entry.levels[tier] = pool.residentSkin(c.id, entry.levels[tier]!); this.levelOwners.set(`${c.sourceKey}\0${tier}`, c.id); this.recount(entry, c.sourceKey);
          mergedBatch = pool; available = tier; break;
        }
        const instances = this.members.get(c.sourceKey)!.length;
        batch = this.batch(entry, tier, keys, instances);
        if (batch) {available = tier; break;}
      }
      if (!available) {this.stats.budgetDrops++; continue;}
      if(available!=='middle')this.releaseMerged(c.id,'middle');
      try {
        const mask=this.options.fastFarMatrices&&available==='far'?entry.activeBones.far:undefined;
        const presentationDistance=c.presentationDistanceM??c.distanceM;
        const angular=Math.max(entry.graph.dims.bodyLength,entry.graph.dims.legReach*2,entry.graph.dims.wingSemiSpan*2)/Math.max(1,presentationDistance);
        const temporal=!!this.options.adaptiveAnimation&&available!=='near'&&presentationDistance>=(this.options.nearM??35)&&angular<.1&&c.animationContext!==undefined;
        let pose:ComposerPose|null=null;
        if(temporal){
          if(actor.temporal&&actor.lastClock===c.rigSeconds&&actor.poseKey!==c.poseKey)actor.temporal=undefined;
          const interval=available==='far'?.1:.05;
          if(!actor.temporal){
            const estimated=entry.graph.bones.length*144+256+Math.max(actor.pose?.contacts.length??0,entry.graph.limbs.length)*256;
            if(this.ownedBytes+estimated-actor.poseBytes<=this.maxBytes){const canonical=this.options.pose(entry.graph,c,this.options.reuseWorkingBuffers??true);this.stats.poseBuilds++;actor.temporal=new ComposerTemporalPose(canonical,c.rigSeconds,c.animationContext!,interval);this.stats.temporalSamples++;}
            else this.stats.temporalBudgetFallbacks++;
          }else if(actor.temporal.needsSample(c.rigSeconds,c.animationContext!,interval)){
            actor.temporal.accept(this.options.pose(entry.graph,c,this.options.reuseWorkingBuffers??true),c.rigSeconds,c.animationContext!,interval);this.stats.poseBuilds++;this.stats.temporalSamples++;
          }
          if(actor.temporal&&(actor.lastClock!==c.rigSeconds||actor.poseKey!==c.poseKey)){pose=actor.temporal.interpolate(c.rigSeconds);this.stats.temporalFrames++;}
        }else if(actor.temporal){actor.temporal=undefined;actor.poseKey=undefined;}
        if(!actor.temporal&&(!actor.pose||c.poseKey===undefined||actor.poseKey!==c.poseKey)){
          pose=this.options.pose(entry.graph,c,this.options.reuseWorkingBuffers??true);this.stats.poseBuilds++;
        }
        if(!pose&&this.options.fastFarMatrices&&actor.tier!==available)pose=actor.pose;
        // New tier may reference joints not used by the previous tier.
        if(actor.tier!==available&&actor.temporal&&!pose)pose=actor.temporal.interpolate(c.rigSeconds);
        if(pose){
          const fast=!!this.options.fastFarMatrices&&available==='far';entry.writer.write(pose,this.scratch,0,mask,fast);if(fast)this.stats.fastBoneMatrices+=mask?.length??entry.graph.bones.length;
          this.stats.boneMatricesAvailable+=entry.graph.bones.length;this.stats.boneMatricesWritten+=mask?.length??entry.graph.bones.length;
          const poseBytes=(actor.temporal?.ownedBytes??composerTypedBytes(pose))+pose.contacts.length*256;
          if(!this.room(poseBytes-actor.poseBytes,keys,false))throw new Error('Composer pose exceeds resident budget');
          const count=entry.graph.bones.length*16,offset=actor.row*this.paletteBones*16;let first=count,last=-1;
          for(let k=0;k<(mask?.length??entry.graph.bones.length);k++){const bone=mask?.[k]??k;for(let j=0;j<16;j++){const i=bone*16+j;if(!Object.is(this.paletteData[offset+i],this.scratch[i])){this.paletteData[offset+i]=this.scratch[i]!;first=Math.min(first,i);last=Math.max(last,i);}}}
          if(last>=0)this.paletteUploads.mark(offset+first,last-first+1);
          actor.pose=pose;actor.poseBytes=poseBytes;actor.poseKey=c.poseKey;actor.lastClock=c.rigSeconds;
        }
        if (c.matrix.elements.some(x => !Number.isFinite(x))) throw new Error('Invalid Composer instance transform');
        const shadow=this.shadowStrength(c,entry.graph);
        if (mergedBatch) mergedBatch.submit(c.id, c.matrix,c.cameraVisible,shadow); else batch!.submit(c.matrix, actor.row,shadow);
        actor.tier = available; this.drawn.add(c.id); this.stats.active++;
        this.stats.triangles += entry.levels[available]!.index.length / 3;
      } catch (error) {this.stats.poseFailures++; this.lastError = String(error);}
    }
    for (const entry of this.entries.values()) for (const batch of Object.values(entry.batches)) {batch.endFrame(); if (batch.mesh.count) this.stats.draws++;}
    for (const batch of this.merged.values()) {batch.endFrame(); this.stats.draws += batch.diagnostics().draws;}
    this.stats.uploadBytes=this.paletteUploads.flush();
    this.stats.upgradesPending=0;for(const c of this.desired.values())if(this.actors.get(c.id)?.tier!==this.candidateTier(c,this.actors.get(c.id)?.tier))this.stats.upgradesPending++;
    this.trimFarOnly(); this.startNext(); return this.drawn;
  }
  private tier(distance: number, previous?: FaunaComposerTier): FaunaComposerTier {
    const near = this.options.nearM ?? 35, middle = this.options.middleM ?? 140;
    if (previous === 'near' && distance < near * 1.1) return 'near';
    if (previous === 'far' && distance > middle * .9) return 'far';
    if (previous === 'middle' && distance >= near * .9 && distance <= middle * 1.1) return 'middle';
    return distance < near ? 'near' : distance < middle ? 'middle' : 'far';
  }
  private candidateTier(c: C, previous?: FaunaComposerTier): FaunaComposerTier {
    const tier = this.tier(c.distanceM, previous);
    if (tier === 'near' && this.fullSourceKeys.has(c.sourceKey)) return 'near';
    return tier !== 'far' && this.middleSourceKeys.has(c.sourceKey) ? 'middle' : 'far';
  }
  private entryBytes(entry: Entry): number {
    let bytes = entry.cpuBytes + entry.writer.ownedBytes;
    if(this.options.reuseWorkingBuffers===false){for(const b of Object.values(entry.batches))bytes+=b.uploadedGeometryBytes+b.instanceBytes*2;}
    else for(const tier of FAUNA_COMPOSER_TIERS){const b=entry.batches[tier];if(b)bytes+=b.uploadedGeometryBytes+b.instanceBytes*2;}
    return bytes;
  }
  private recount(entry: Entry, key: string): void {
    entry.cpuBytes = composerTypedBytes({source: entry.source, levels: entry.levels,activeBones:entry.activeBones}, this.arenaBuffers) + (entry.definition.length + key.length + entry.graphIdentity.length + entry.skinIdentity.length) * 2 + entry.graphBytes;
  }
  get ownedBytes(): number {let n = this.paletteData.byteLength * 2 + this.scratch.byteLength + this.paletteUploads.ownedBytes + this.actorRows.byteLength + (this.frameSourceKeys.size+this.priorSourceKeys.size)*64 + (this.options.provider.diagnosticBytes ?? 0); for (const e of this.entries.values()) n += this.entryBytes(e); for (const a of this.actors.values()) n += a.poseBytes; for (const b of this.merged.values()) n += this.options.reuseWorkingBuffers===false?b.diagnostics().ownedBytes:b.ownedBytes; return n;}
  private get stagedBytes(): number {let bytes = 0; for (const p of this.ready.values()) bytes += p.bytes; return bytes;}
  get reservedBytes(): number {return this.disposed ? 0 : this.ownedBytes + this.workerReserveBytes + this.stagedBytes + (this.running ? this.maxResultBytes : 0);}
  /** Allocation-free counters for a live benchmark; diagnostics() remains a snapshot. */
  get pendingPresentationWork(){return this.ready.size+(this.running?1:0)+this.stats.upgradesPending;}
  get uploadedPaletteBytes(){return this.paletteUploads.uploadedBytes;}
  get paletteUploadCalls(){return this.paletteUploads.uploadCount;}
  private room(bytes: number, protectedKeys: ReadonlySet<string>, extraEntry: boolean): boolean {
    while (this.ownedBytes + bytes > this.maxBytes || (extraEntry && this.entries.size >= this.maxSources)) {
      const victim = [...this.entries].filter(([key]) => !protectedKeys.has(key)).sort((a, b) => a[1].used - b[1].used)[0];
      if (!victim) return false; this.evict(victim[0]);
    }
    return true;
  }
  private batch(entry: Entry, tier: FaunaComposerTier, protectedKeys: ReadonlySet<string>, instances: number): FaunaComposerInstanceBatch | null {
    const existing = entry.batches[tier]; if (existing && existing.capacity >= instances) return existing;
    const skin = entry.levels[tier]!;
    if (isPackedComposerSkin(skin)||isGpuComposerSkin(skin)) return null; // Packed storage is an explicit arena representation only.
    // sourceVertex is not uploaded. This upper bound also counts it and safely over-reserves admission.
    const bytes = (existing ? 0 : composerTypedBytes(skin)) + instances * 68 * 2 - (existing?.instanceBytes ?? 0) * 2;
    if (!this.room(bytes, protectedKeys, false)) return null;
    existing?.dispose();
    const batch = new FaunaComposerInstanceBatch(skin, this.paletteUniform, instances, sourceRoughness(entry.graph));
    try {this.options.onMeshAdopted?.(batch.mesh);} catch (error) {batch.dispose(); this.lastError = String(error); return null;}
    entry.batches[tier] = batch; this.group.add(batch.mesh); return batch;
  }
  private identity(definition: unknown, freeze = false, canonicalDefinition?: string): string {
    if (definition && typeof definition === 'object') {
      const cached = this.identities.get(definition);
      if (cached !== undefined) {
        if(canonicalDefinition!==undefined&&canonicalDefinition!==cached)throw new Error('Composer shared canonical identity mismatch');
        return cached;
      }
      const serialized = canonicalComposerJson(definition);
      if(canonicalDefinition!==undefined&&canonicalDefinition!==serialized)throw new Error('Composer shared canonical identity mismatch');
      const identity = canonicalDefinition ?? serialized;
      if (freeze) {freezeComposerDefinition(definition); this.identities.set(definition, identity);}
      return identity;
    }
    const serialized=canonicalComposerJson(definition);
    if(canonicalDefinition!==undefined&&canonicalDefinition!==serialized)throw new Error('Composer shared canonical identity mismatch');
    return canonicalDefinition??serialized;
  }
  /** Runs in the completion task, outside update(). The production provider has
   * verified strict worker checks against digests of the actual received arrays.
   * Custom providers retain the full local validation path. */
  private async prepare(run: Running, result: FaunaComposerBuildResult): Promise<Prepared> {
    const started = this.now();
    if (result.key !== run.key || !result.source || result.source.skin.version !== 'fauna-composer-skin-6') throw new Error('Composer source identity/version mismatch');
    const count = result.source.graph.bones.length;
    if (count < 1 || count > this.maxBones || composerTypedBytes(result) > this.maxResultBytes) throw new Error('Composer build result exceeds budget');
    if (canonicalComposerJson(run.definitionRef) !== run.definition) throw new Error('Composer definition mutated during build');
    if (!isVerifiedComposerBuild(result)) {
      this.stats.verificationOnMain++;
      validateComposerRenderSkin({...result.source.skin, sourceVertex: null}, count);
      for (const level of Object.values(result.levels)) {validateComposerRenderSkin(level, count); validateComposerRenderLod(result.source.skin, level);}
    }
    for (const level of Object.values(result.levels)) if (level.version !== result.source.skin.version) throw new Error('LOD source version mismatch');
    if (!Object.keys(result.levels).length || run.tiers.some(tier => !result.levels[tier])) throw new Error('Composer build omitted requested levels');
    const graph = result.source.graph, levels = {...result.levels};
    // Cache the compact requested tiers, not all incidental reducer snapshots.
    for (const tier of FAUNA_COMPOSER_TIERS) if (!run.tiers.includes(tier)) delete levels[tier];
    const source = this.fullSourceKeys.has(run.key) ? result.source : null;
    if (!source) delete levels.near;
    const graphIdentity = isVerifiedComposerBuild(result) ? result.receipt!.graphDigest : await composerContentDigest(graph), writer = new FaunaComposerPaletteWriter(graph,this.options.reuseWorkingBuffers??true);
    const skinIdentity = isVerifiedComposerBuild(result) ? result.receipt!.skinDigest : await composerContentDigest(result.source.skin);
    const graphBytes = canonicalComposerJson(graph).length * 2;
    const activeBones:Partial<Record<FaunaComposerTier,Uint16Array>>={};for(const tier of FAUNA_COMPOSER_TIERS)if(levels[tier])activeBones[tier]=composerActiveBones(levels[tier]!,graph.bones.length);
    const bytes = graphBytes + composerTypedBytes({source, levels,activeBones}) + (run.definition.length + run.key.length + graphIdentity.length + skinIdentity.length) * 2 + writer.ownedBytes;
    this.stats.preparationMs = this.now() - started;
    return {run, source, graph, graphIdentity, skinIdentity, graphBytes, levels,activeBones, writer, bytes, buildMs: result.buildMs, attempt: -1};
  }
  private retain(prepared: Prepared): void {
    this.ready.set(prepared.run.key, prepared);
    // Finished animals remain an LRU cache even after a one-frame visibility
    // change. Staging is bounded separately from resident CPU/GPU allocations.
    while (this.stagedBytes > this.maxResultBytes) {
      const candidates = [...this.ready].sort((a, b) => Number(this.members.has(a[0])) - Number(this.members.has(b[0])));
      const [key, victim] = candidates[0]!;
      this.ready.delete(key); this.blocked.set(key, {bytes: victim.bytes, extra: !this.entries.has(key), revision: this.revision}); this.stats.stagedEvictions++;
    }
    while (this.blocked.size > this.maxSources) this.blocked.delete(this.blocked.keys().next().value!);
  }
  private adoptPending(keys: ReadonlySet<string>): void {
    this.stats.adoptionMs = 0; const started = this.now();
    for (const [key, p] of this.ready) {
      if (this.now() - started >= (this.options.adoptionBudgetMs ?? 3)) break;
      if (p.attempt === this.revision) continue;
      p.attempt = this.revision;
      try {
        if (p.run.epoch !== this.epoch) {this.ready.delete(key); this.stats.stale++; continue;}
        // Definitions can be mutable before admission, but never afterward.
        if (canonicalComposerJson(p.run.definitionRef) !== p.run.definition || this.members.get(key)?.some(c => this.identity(c.definition, false, c.canonicalDefinition) !== p.run.definition)) throw new Error('Composer definition mutated during build/admission');
        const prior = this.entries.get(key);
        if (prior && (prior.graphIdentity !== p.graphIdentity || prior.skinIdentity !== p.skinIdentity)) throw new Error('Composer original source changed during upgrade');
        let source = prior?.source ?? p.source;
        const levels = {...p.levels, ...prior?.levels};const activeBones={...prior?.activeBones,...p.activeBones};
        if (!this.fullSourceKeys.has(key) && (levels.middle || levels.far)) {source = null; delete levels.near;}
        if (!Object.keys(levels).length) {this.ready.delete(key); continue;}
        const writer = prior?.writer ?? p.writer;
        const cpuBytes = p.graphBytes + composerTypedBytes({source, levels,activeBones}, this.arenaBuffers) + (p.run.definition.length + key.length + p.graphIdentity.length + p.skinIdentity.length) * 2;
        const width = Math.max(this.paletteBones, Math.min(this.maxBones, Math.ceil(p.graph.bones.length / 16) * 16));
        const paletteGrowth = (width - this.paletteBones) * this.capacity * 16 * 4 * 2;
        const added = cpuBytes + writer.ownedBytes - (prior ? prior.cpuBytes + prior.writer.ownedBytes : 0) + paletteGrowth;
        if (!this.room(added, new Set([...keys, key]), !prior)) {this.stats.blockedAdmissions++; this.lastError = 'Composer resident source budget full; completed source retained'; p.attempt = this.revision; continue;}
        if (width !== this.paletteBones) this.resizePalette(width);
        this.identity(p.run.definitionRef, true, p.run.definition); for (const c of this.members.get(key) ?? []) this.identity(c.definition, true, c.canonicalDefinition);
        const middle = p.levels.middle;
        this.entries.set(key, {source,activeBones, graph: p.graph, graphIdentity: p.graphIdentity, skinIdentity: p.skinIdentity, graphBytes: p.graphBytes, levels, writer, definition: p.run.definition, batches: prior?.batches ?? {}, used: this.frame, cpuBytes,
          middleFootprint: middle ? {vertices: middle.positions.length / 3, indices: middle.index.length} : prior?.middleFootprint});
        this.ready.delete(key); this.blocked.delete(key); this.failed.delete(key); this.stats.builds++; this.stats.buildMs += p.buildMs;
        if (!keys.has(key)) this.stats.completedOutOfView++;
        this.revision++;
      } catch (error) {this.ready.delete(key); this.fail(key, error);}
    }
    this.stats.adoptionMs = this.now() - started;
    if (this.stats.adoptionMs > (this.options.adoptionBudgetMs ?? 3)) this.stats.adoptionOverruns++;
  }
  private startNext(): void {
    if (this.running || this.disposed) return;
    // Bounded near refinement prevents a large cold census from leaving the
    // closest animals coarse for minutes. Only already retained originals qualify;
    // cold coverage continues between promotions and middle upgrades stay last.
    const promoteNear = this.coldJobs >= (this.options.coldJobsBeforeNearUpgrade ?? Infinity);
    const passes = promoteNear ? ['near', 'cold', 'upgrade'] : ['cold', 'upgrade'];
    for (const pass of passes) for (const [key, members] of this.members) {
      const cold = pass === 'cold';
      const c = members[0]!, entry = this.entries.get(key);
      if ((!entry || !Object.keys(entry.levels).length) !== cold || this.ready.has(key) || (this.failed.get(key) ?? -Infinity) > this.frame - 120) continue;
      let tier:FaunaComposerTier|undefined=cold?'far':undefined;
      if(!cold)for(const member of members){const wanted=this.candidateTier(member,this.actors.get(member.id)?.tier);
        if(!entry?.levels[wanted]&&(!tier||FAUNA_COMPOSER_TIERS.indexOf(wanted)<FAUNA_COMPOSER_TIERS.indexOf(tier)))tier=wanted;
      }
      if(!tier)continue;
      if (pass === 'near' && (tier !== 'near' || !entry?.source)) continue;
      if (entry?.levels[tier]) continue;
      const blocked = this.blocked.get(key);
      if (blocked) {
        if (blocked.revision === this.revision) continue;
        blocked.revision = this.revision;
        // Known actual compact result bytes preflight retry; no timed rebuild loop.
        if (!this.room(Math.max(0, blocked.bytes - (entry ? entry.cpuBytes + entry.writer.ownedBytes : 0)), new Set(this.members.keys()), blocked.extra)) continue;
        this.blocked.delete(key);
      }
      const run: Running = {key, definition: this.identity(c.definition, false, c.canonicalDefinition), definitionRef: c.definition, tiers: [tier], epoch: this.epoch, abort: new AbortController()};
      this.running = run;
      if (cold) this.coldJobs++; else if (tier === 'near') this.coldJobs = 0;
      const failedFrame = this.failed.get(key);
      try {Promise.resolve(this.options.provider.build({key, definition: c.definition, tiers: run.tiers, loadedSource: entry?.source ?? undefined,
        ...(failedFrame === undefined ? {} : {diagnosticRetry: {failedFrame, currentFrame: this.frame}})}, run.abort.signal)).then(async result => {
        if (this.disposed || run.abort.signal.aborted || run.epoch !== this.epoch) {this.stats.stale++; return;}
        const prepared = await this.prepare(run, result);
        if (this.disposed || run.abort.signal.aborted || run.epoch !== this.epoch) {this.stats.stale++; return;}
        this.retain(prepared);
      }).catch(error => {if (!run.abort.signal.aborted && !this.disposed) this.fail(key, error);}).finally(() => {
        if (this.running === run) this.running = null; if (!this.disposed) this.options.onReady?.();
      });} catch (error) {this.running = null; this.fail(key, error);}
      return;
    }
  }
  private trimFullSources(): void {
    for (const [key, entry] of this.entries) if (!this.fullSourceKeys.has(key) && entry.source && (entry.levels.middle || entry.levels.far)) {
      this.revision++; entry.batches.near?.dispose(); delete entry.batches.near; delete entry.levels.near; entry.source = null;
      this.recount(entry, key);
    }
  }
  private trimFarOnly(): void {
    for (const [key, entry] of this.entries) {
      if (!entry.levels.far || !entry.levels.middle) continue;
      const members = this.members.get(key) ?? [];
      if (!members.length || members.some(c => this.candidateTier(c, this.actors.get(c.id)?.tier) !== 'far' || this.actors.get(c.id)?.tier !== 'far')) continue;
      for(const [id,binding]of this.mergedBindings)if(binding.middle===key)this.releaseMerged(id,'middle');
      this.revision++; entry.batches.middle?.dispose(); delete entry.batches.middle; delete entry.levels.middle;
      this.recount(entry, key);
    }
  }
  private fail(key: string, error: unknown): void {
    this.failed.set(key, this.frame); while (this.failed.size > this.maxSources) this.failed.delete(this.failed.keys().next().value!);
    this.stats.failures++; this.lastError = error instanceof Error ? error.message : String(error);
  }
  private evict(key: string): void {
    const entry = this.entries.get(key); if (!entry) return;
    for (const batch of Object.values(entry.batches)) batch.dispose(); this.entries.delete(key);
    for (const [id, actor] of this.actors) if (actor.key === key) {this.releaseMerged(id); this.actors.delete(id);}
    this.stats.evictions++; this.revision++;
  }
  private releaseMerged(id: string,tier?:MergedTier): void {
    const bindings = this.mergedBindings.get(id); if (!bindings) return;
    for(const kind of tier?[tier]:['middle','far'] as const){
      const key=bindings[kind];if(!key)continue;
      const ownerKey = `${key}\0${kind}`, entry = this.entries.get(key), pool = this.merged.get(kind)!;
      if (this.levelOwners.get(ownerKey) === id) {
        const replacement = [...this.mergedBindings].find(([other, b]) => other !== id && b[kind]===key);
        if (replacement && entry?.levels[kind]) {entry.levels[kind] = pool.residentSkin(replacement[0], entry.levels[kind]!); this.levelOwners.set(ownerKey, replacement[0]);}
        else {if (entry) delete entry.levels[kind]; this.levelOwners.delete(ownerKey);}
        if (entry) this.recount(entry, key);
      }
      pool.release(id);delete bindings[kind];this.revision++;
    }
    if(!bindings.middle&&!bindings.far)this.mergedBindings.delete(id);
  }
  sourceOf(id: string): FaunaComposerSource | null {const actor = this.actors.get(id); return actor ? this.entries.get(actor.key)?.source ?? null : null;}
  /** Explicit QA/inspection only; callers must copy before mutating borrowed arrays. */
  snapshotOf(id:string){
    const actor=this.actors.get(id),entry=actor?this.entries.get(actor.key):undefined;
    if(!actor||!entry||!actor.tier)return null;
    const skin=entry.levels[actor.tier];
    return {id,key:actor.key,tier:actor.tier,graph:entry.graph,skin:skin?FaunaComposerMergedBatch.snapshotSkin(skin):null,source:entry.source,pose:actor.pose,presentation:actor.temporal?.metadata()??null,activeBones:entry.activeBones[actor.tier],
      palette:this.paletteData.subarray(actor.row*this.paletteBones*16,actor.row*this.paletteBones*16+entry.graph.bones.length*16)};
  }
  poseOf(id: string): ComposerPose | null {return this.actors.get(id)?.pose ?? null;}
  diagnostics() {return {version: FAUNA_COMPOSER_RENDER_VERSION, ...this.stats, contextLost:this.contextLost, capacity: this.capacity, sources: this.entries.size,
    middleSourceLimit: this.options.middleSourceCache ?? this.maxSources, middleSourcesEligible: this.middleSourceKeys.size,
    farTierBudgetFallbacks: [...this.desired.values()].filter(c => this.tier(c.distanceM, this.actors.get(c.id)?.tier) !== 'far' && this.candidateTier(c, this.actors.get(c.id)?.tier) === 'far').length,
    actors: [...this.drawn].map(id => {const actor = this.actors.get(id)!, entry = this.entries.get(actor.key)!; return {id, key: actor.key, tier: actor.tier, bones: entry.graph.bones.length, skin: entry.levels[actor.tier!]!.version,activeBones:entry.activeBones[actor.tier!]?.length??entry.graph.bones.length,presentation:actor.temporal?.metadata()??null};}),
    ownedBytes: this.ownedBytes, maxBytes: this.maxBytes, reservedBytes: this.reservedBytes, workerReserveBytes: this.workerReserveBytes,
    paletteUploadTrackingBytes:this.paletteUploads.ownedBytes,actualPaletteUploadedBytes:this.paletteUploads.uploadedBytes,paletteUploadCount:this.paletteUploads.uploadCount,pendingPaletteUploadBytes:this.paletteUploads.pendingBytes,
    paletteBones: this.paletteBones, paletteCpuBytes: this.paletteData.byteLength, paletteGpuBytes: this.paletteData.byteLength,
    graphJsonEquivalentBytes: [...this.entries.values()].reduce((n, e) => n + e.graphBytes, 0),
    sourceCpuBytes: [...this.entries.values()].reduce((n, e) => n + e.cpuBytes, 0),
    geometryGpuBytes: [...this.entries.values()].reduce((n, e) => n + Object.values(e.batches).reduce((m, b) => m + b.uploadedGeometryBytes, 0), 0),
    instanceCpuGpuBytes: [...this.entries.values()].reduce((n, e) => n + Object.values(e.batches).reduce((m, b) => m + b.instanceBytes * 2, 0), 0),
    pendingResultBytes: this.stagedBytes, stagedSources: this.ready.size, blockedSources: this.blocked.size, receivingReserveBytes: this.running ? this.maxResultBytes : 0,
    poseCpuBytes: [...this.actors.values()].reduce((n, a) => n + a.poseBytes, 0),
    mergedTiers: Object.fromEntries([...this.merged].map(([tier, batch]) => [tier, batch.diagnostics()])),
    running: this.running?.key ?? null, lastError: this.lastError,
    workerDiagnosticBytes: this.options.provider.diagnosticBytes ?? 0, workerDiagnostics: this.options.provider.diagnostics?.() ?? null};}
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.epoch++; this.running?.abort.abort(); this.ready.clear(); this.blocked.clear();
    this.options.mergedGpuContext?.canvas.removeEventListener('webglcontextlost',this.onContextLost);
    this.options.mergedGpuContext?.canvas.removeEventListener('webglcontextrestored',this.onContextRestored);
    for (const key of this.entries.keys()) this.evict(key); this.paletteUploads.dispose();this.paletteUniform.value.dispose(); this.options.provider.dispose?.();
    for (const batch of this.merged.values()) batch.dispose(); this.merged.clear(); this.mergedBindings.clear(); this.levelOwners.clear(); this.arenaBuffers.clear();
    this.paletteData = new Float32Array(0); this.scratch = new Float32Array(0); this.paletteUniform.value.image.data = this.paletteData;
    this.actorRows=new Uint8Array(0);this.frameSourceKeys.clear();this.priorSourceKeys.clear();
    this.actors.clear(); this.desired.clear(); this.members.clear(); this.drawn.clear(); this.failed.clear(); this.group.removeFromParent();
    this.fullSourceKeys.clear(); this.middleSourceKeys.clear();
  }
}
