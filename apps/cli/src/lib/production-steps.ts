import { META } from '@/__meta__';
import { getSelectedProjectAddons } from '@/lib/addon-utils';
import { getAppScripts, getRootScripts } from '@/lib/package-json-generator';
import { getScriptCommand, getScriptCommandInApp } from '@/lib/package-manager';
import { resolveConditionals } from '@/lib/when';
import type { TemplateContext } from '@/types/ctx';
import type { ProductionScript } from '@/types/meta';
import type { StackName } from '@/types/stack-name';

interface ProductionStep {
  description: string;
  command: string;
}

/** The production scripts the given stacks and the selected addons declare, stacks first, each script once. */
function declaredProductionScripts(ctx: TemplateContext, stacks: StackName[]): ProductionScript[] {
  const declared = [
    ...stacks.flatMap((stack) => META.stacks[stack].productionScripts ?? []),
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
 * root defines runs from the root, in the order the stacks of the apps and the addons declare. A script only the
 * apps define gets a line per app that has it, app by app, each app in its own declared order (its stack, then the
 * addons), so every app's sequence runs as printed.
 */
export function collectProductionSteps(ctx: TemplateContext): ProductionStep[] {
  const rootScripts = getRootScripts(ctx);
  const appScripts = getAppScripts(ctx);

  const rootSteps = declaredProductionScripts(
    ctx,
    ctx.apps.map((app) => app.stackName),
  )
    .filter(({ script }) => script in rootScripts)
    .map(({ script, description }) => ({ description, command: getScriptCommand(ctx, script) }));

  const appSteps = ctx.apps.flatMap((app, index) =>
    declaredProductionScripts(ctx, [app.stackName])
      .filter(({ script }) => !(script in rootScripts) && script in (appScripts[index]?.scripts ?? {}))
      .map(({ script, description }) => ({
        description: `${description} (${app.appName})`,
        command: getScriptCommandInApp(ctx, script, app.appName),
      })),
  );

  return [...rootSteps, ...appSteps];
}
