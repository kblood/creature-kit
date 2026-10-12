import type {ComposerMotion} from '../../../src/fauna-composer-rig.ts';

/** Shared labels for specimen preview and population measurement. */
export const COMPOSER_MOTION_LABELS:Record<ComposerMotion,string>={
 neutral:'Rest pose (unanimated)',idle:'Standing',walk:'Walking',display:'Display (wings, arms, trunk)',
 run:'Running',eat:'Eating / foraging',fly:'Flying (winged animals)',glide:'Gliding (winged animals)',
};
