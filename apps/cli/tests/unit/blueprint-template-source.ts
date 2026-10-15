import { type BlueprintLinks, resolveBlueprintChain } from '@/lib/template-resolver';

export function isBlueprintTemplate(
  source: string,
  blueprintName: string,
  blueprints?: BlueprintLinks,
): boolean {
  return resolveBlueprintChain(blueprintName, blueprints).some((name) => source.includes(`/blueprints/${name}/`));
}
