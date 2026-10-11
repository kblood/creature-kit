import {normalizeComposerRecipe, type ComposerRecipe} from './fauna-composer-recipe.ts';
import {deriveComposerIndividual} from './fauna-composer-individual.ts';
import {buildComposerGraph, COMPOSER_BUDGET} from './fauna-composer-rig.ts';
import {buildComposerSkin, type ComposerSkinOptions} from './fauna-composer-mesh.ts';
import {assertComposerResolvedRecipe, type ComposerBuildPhenotype} from './fauna-composer-phenotype.ts';

export interface ComposerSourceOptions extends ComposerSkinOptions {phenotype?: ComposerBuildPhenotype}
/** Shared deterministic source path for the Lab actor, planet worker and export.
 * No renderer, material, scene object or GPU resource is created here. */
export function buildComposerSource(input: ComposerRecipe, options: ComposerSourceOptions = {}) {
  const recipe = normalizeComposerRecipe(input).recipe;
  if (options.phenotype) assertComposerResolvedRecipe(recipe);
  const individual = deriveComposerIndividual(recipe);
  const graph = buildComposerGraph(individual.recipe, {phenotype: options.phenotype});
  const skin = buildComposerSkin(graph, options);
  if (skin.vertexCount > COMPOSER_BUDGET.maxVertices || skin.triangleCount > COMPOSER_BUDGET.maxTriangles)
    throw new Error(`Composer skin exceeds the desktop preview budget (${skin.vertexCount} vertices, ${skin.triangleCount} triangles).`);
  return {recipe, individual, graph, skin};
}
export type ComposerSource = ReturnType<typeof buildComposerSource>;
