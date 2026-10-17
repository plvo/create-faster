import { META } from '@/__meta__';
import { getSelectedProjectAddons } from '@/lib/addon-utils';
import { getAppScripts, getRootScripts } from '@/lib/package-json-generator';
import { getScriptCommand, getScriptCommandInApp } from '@/lib/package-manager';
import { resolveConditionals } from '@/lib/when';
import type { TemplateContext } from '@/types/ctx';
import type { ProductionScript } from '@/types/meta';

interface ProductionStep {
  description: string;
  command: string;
}

/** The production scripts the stacks of the apps and the selected addons declare, in order, each script once. */
function collectProductionScripts(ctx: TemplateContext): ProductionScript[] {
  const declared = [
    ...ctx.apps.flatMap((app) => META.stacks[app.stackName].productionScripts ?? []),
    ...getSelectedProjectAddons(ctx).flatMap((addon) => addon.productionScripts ?? []),
  ];
  const scripts = new Map<string, ProductionScript>();
  for (const productionScript of resolveConditionals(declared, ctx)) {
    const { script, description } = productionScript;
    if (script !== undefined && description !== undefined && !scripts.has(script)) {
      scripts.set(script, { script, description });
    }
  }
  return [...scripts.values()];
}

/**
 * The production commands the project defines: the README, AGENTS.md and the CLI summary print them. A script the
 * root defines runs from the root; one only the apps define gets a line per app that has it.
 */
export function collectProductionSteps(ctx: TemplateContext): ProductionStep[] {
  const rootScripts = getRootScripts(ctx);
  const apps = getAppScripts(ctx);

  return collectProductionScripts(ctx).flatMap(({ script, description }) => {
    if (script in rootScripts) return [{ description, command: getScriptCommand(ctx, script) }];

    return apps
      .filter(({ scripts }) => script in scripts)
      .map(({ appName }) => ({
        description: `${description} (${appName})`,
        command: getScriptCommandInApp(ctx, script, appName),
      }));
  });
}
