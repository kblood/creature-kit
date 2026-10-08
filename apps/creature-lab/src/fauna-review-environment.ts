import * as THREE from 'three';
import {FAUNA_REVIEW_SHADOWS} from './fauna-review-lighting.ts';

/** Lighting presets for desktop creature review (Creature Lab composer and planet skin modes).
 *
 * 'studio' is the Lab's original light rig, unchanged: bright, flat fill (fill/key about 0.9)
 * that shows shape everywhere but flatters every surface. The 'planet-*' presets reproduce
 * what an animal standing on a planet surface receives in the game (main.ts sun and ambient,
 * SurfaceLighting sky and ground bounce): one strong warm sun, a weak sky dome and a
 * ground-coloured bounce, so fill/key is about 0.26. Coat contrast, form shading and cast
 * shadows then read as they do in the world.
 *
 * No PMREM or environment map is created; every preset is three analytic lights. Colours
 * are given as sRGB hex and converted by THREE.Color (linear working space), exactly like
 * main.ts and surface-lighting.ts, so the ground bounce matches the planet to float precision. */
/** The planet surface's sky-dome colour and ground albedo (linear working space, from sRGB hex), inlined from
 * universe-atlas src/surface-lighting.ts SURFACE_SKY_COLOR and SURFACE_GROUND_ALBEDO (universe-atlas 7419733) so the kit
 * app needs no Atlas module. tests/lab/creature-lab-atlas-parity.test.mjs checks they still equal Atlas's (ATLAS_DIR). */
export const REVIEW_SKY_COLOR = new THREE.Color('#b5cce3');
export const REVIEW_GROUND_ALBEDO = new THREE.Color('#697451');

export const FAUNA_REVIEW_PRESET_IDS = ['studio', 'planet-noon', 'planet-evening'] as const;
export type FaunaReviewPresetId = typeof FAUNA_REVIEW_PRESET_IDS[number];

export interface FaunaReviewPreset {
  readonly id: FaunaReviewPresetId;
  readonly label: string;
  readonly description: string;
  /** Scene clear colour (sRGB hex). */
  readonly background: string;
  /** Albedo of the review ground plane (sRGB hex). */
  readonly ground: string;
  /** Renderer ACES tone-mapping exposure that matches the reference (Lab 1.15, planet main.ts 1.2). */
  readonly exposure: number;
  readonly key: {readonly color: string; readonly intensity: number;
    /** World-space key position; the light aims at the origin. */
    readonly position: readonly [number, number, number]};
  readonly hemisphere: {readonly sky: string; readonly intensity: number;
    /** Explicit lower-hemisphere colour (studio), or 'surface' for the SurfaceLighting ground-bounce formula. */
    readonly ground: string | 'surface'};
  readonly ambient: {readonly color: string; readonly intensity: number};
}

/** Studio key position (creature-lab.ts before this module); planet suns keep its azimuth. */
const STUDIO_KEY: readonly [number, number, number] = [-20, 38, 26];
const STUDIO_DISTANCE = Math.hypot(...STUDIO_KEY);
/** A key at `elevationDeg` above the horizon, from the studio key's compass direction, at the studio distance. */
export function faunaReviewSunPosition(elevationDeg: number): [number, number, number] {
  const e = THREE.MathUtils.degToRad(elevationDeg), h = Math.hypot(STUDIO_KEY[0], STUDIO_KEY[2]);
  const horizontal = Math.cos(e) * STUDIO_DISTANCE;
  return [STUDIO_KEY[0] / h * horizontal, Math.sin(e) * STUDIO_DISTANCE, STUDIO_KEY[2] / h * horizontal];
}
/** main.ts ambient ('#91b3cc', 0.22) after SurfaceLighting's full-daylight reduction (x 0.4). */
const PLANET_AMBIENT = {color: '#91b3cc', intensity: 0.22 * 0.4} as const;
const PLANET_SKY_HEX = `#${REVIEW_SKY_COLOR.getHexString()}`;
const PLANET_GROUND_HEX = `#${REVIEW_GROUND_ALBEDO.getHexString()}`;

export const FAUNA_REVIEW_PRESETS: Readonly<Record<FaunaReviewPresetId, FaunaReviewPreset>> = Object.freeze({
  studio: Object.freeze({
    id: 'studio', label: 'Studio (bright, even)',
    description: 'The original Lab light: strong cool fill from every side. Shows shape everywhere; flatter than any real sky.',
    background: '#08131a', ground: '#36504a', exposure: 1.15,
    key: Object.freeze({color: '#ffe0b2', intensity: 3.8, position: STUDIO_KEY}),
    hemisphere: Object.freeze({sky: '#cdeeff', ground: '#263d32', intensity: 2.8}),
    ambient: Object.freeze({color: '#56817b', intensity: 0.6}),
  }),
  'planet-noon': Object.freeze({
    id: 'planet-noon', label: 'Planet surface, midday',
    description: 'In-game daylight: sun 55 degrees high, weak sky fill and ground bounce, with cast shadows.',
    background: '#a9c0d6', ground: PLANET_GROUND_HEX, exposure: 1.2,
    key: Object.freeze({color: '#fff1dc', intensity: 3.0, position: faunaReviewSunPosition(55)}),
    hemisphere: Object.freeze({sky: PLANET_SKY_HEX, ground: 'surface', intensity: 0.7}),
    ambient: Object.freeze({...PLANET_AMBIENT}),
  }),
  'planet-evening': Object.freeze({
    id: 'planet-evening', label: 'Planet surface, evening',
    description: 'Low warm sun 12 degrees high with long shadows; dim sky fill.',
    background: '#c9a385', ground: PLANET_GROUND_HEX, exposure: 1.2,
    key: Object.freeze({color: '#ffb070', intensity: 1.6, position: faunaReviewSunPosition(12)}),
    hemisphere: Object.freeze({sky: PLANET_SKY_HEX, ground: 'surface', intensity: 0.35}),
    ambient: Object.freeze({...PLANET_AMBIENT}),
  }),
});
export function isFaunaReviewPresetId(value: unknown): value is FaunaReviewPresetId {
  return typeof value === 'string' && (FAUNA_REVIEW_PRESET_IDS as readonly string[]).includes(value);
}

/** Lower-hemisphere colour of a preset (linear RGB). For planet presets this is SurfaceLighting's
 * ground bounce: albedo x (sun colour x direct irradiance per unit sky intensity + sky colour). */
export function faunaReviewGroundColor(preset: FaunaReviewPreset): THREE.Color {
  if (preset.hemisphere.ground !== 'surface') return new THREE.Color(preset.hemisphere.ground);
  const up = new THREE.Vector3(0, 1, 0), sun = new THREE.Vector3(...preset.key.position).normalize();
  const sky = new THREE.Color(preset.hemisphere.sky), sunColor = new THREE.Color(preset.key.color);
  const direct = Math.max(0, up.dot(sun)) * Math.max(0, preset.key.intensity) / preset.hemisphere.intensity;
  return sunColor.multiplyScalar(direct).add(sky).multiply(REVIEW_GROUND_ALBEDO);
}
/** (hemisphere + ambient) / key intensity: how much the shadowed side is filled. */
export function faunaReviewFillKeyRatio(preset: FaunaReviewPreset): number {
  return (preset.hemisphere.intensity + preset.ambient.intensity) / preset.key.intensity;
}

export interface FaunaReviewLighting {
  readonly preset: FaunaReviewPreset;
  readonly lights: readonly THREE.Light[];
  /** The shadow-casting directional key (sun). Its target stays at the world origin. */
  readonly key: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  /** Removes the lights, frees the shadow map and restores the previous scene background. */
  dispose(): void;
}
/** Adds a preset's lights to `scene` and sets its background. The key gets the review shadow map size;
 * shadow casting and frustum fitting stay with the caller (fitFaunaReviewShadow). */
export function applyFaunaReviewLighting(scene: THREE.Scene, presetOrId: FaunaReviewPreset | FaunaReviewPresetId): FaunaReviewLighting {
  const preset = typeof presetOrId === 'string' ? FAUNA_REVIEW_PRESETS[presetOrId] : presetOrId;
  if (!preset || !isFaunaReviewPresetId(preset.id)) throw new Error(`Unknown fauna review lighting preset: ${String(presetOrId).slice(0, 40)}`);
  const hemisphere = new THREE.HemisphereLight(preset.hemisphere.sky, 0xffffff, preset.hemisphere.intensity);
  hemisphere.groundColor.copy(faunaReviewGroundColor(preset));
  hemisphere.name = `fauna-review-${preset.id}-sky`;
  const key = new THREE.DirectionalLight(preset.key.color, preset.key.intensity);
  key.position.set(...preset.key.position);
  key.shadow.mapSize.set(FAUNA_REVIEW_SHADOWS.mapSize, FAUNA_REVIEW_SHADOWS.mapSize);
  key.name = `fauna-review-${preset.id}-key`;
  const ambient = new THREE.AmbientLight(preset.ambient.color, preset.ambient.intensity);
  ambient.name = `fauna-review-${preset.id}-ambient`;
  const previousBackground = scene.background;
  scene.add(hemisphere, key, ambient);
  scene.background = new THREE.Color(preset.background);
  let disposed = false;
  return {
    preset, lights: [hemisphere, key, ambient], key, hemisphere, ambient,
    dispose() {
      if (disposed) return; disposed = true;
      scene.remove(hemisphere, key, ambient);
      key.shadow.map?.dispose(); key.shadow.dispose();
      if (scene.background instanceof THREE.Color && scene.background.equals(new THREE.Color(preset.background))) scene.background = previousBackground;
    },
  };
}
