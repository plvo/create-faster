import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type BlueprintLinks, resolveBlueprintChain } from '@/lib/template-resolver';

/** Whether the blueprint, or a blueprint it extends, ships GitHub workflows in its template folder. */
export function shipsWorkflows(blueprint: string, blueprintsDir: string, blueprints?: BlueprintLinks): boolean {
  return resolveBlueprintChain(blueprint, blueprints).some((folder) =>
    existsSync(join(blueprintsDir, folder, '__github/workflows')),
  );
}
