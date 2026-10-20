import { META } from '@/__meta__';
import { getSelectedProjectAddons } from '@/lib/addon-utils';
import { getAppScripts, getRootScripts } from '@/lib/package-json-generator';
import { getScriptCommand, getScriptCommandInApp } from '@/lib/package-manager';
import { resolveScriptDescriptions } from '@/lib/script-description';
import type { AppContext, TemplateContext } from '@/types/ctx';
import type { ScriptDescription } from '@/types/meta';
import type { StackName } from '@/types/stack-name';

export interface ScriptStep {
  description: string;
  command: string;
}

/** The production scripts the given stacks and the selected addons declare, stacks first, each script once. */
function declaredProductionScripts(ctx: TemplateContext, stacks: StackName[]): ScriptDescription[] {
  const declared = [
    ...stacks.flatMap((stack) => META.stacks[stack].productionScripts ?? []),
    ...getSelectedProjectAddons(ctx).flatMap((addon) => addon.productionScripts ?? []),
  ];
  const scripts = new Map<string, ScriptDescription>();
  for (const productionScript of resolveScriptDescriptions(declared, ctx)) {
    if (!scripts.has(productionScript.script)) scripts.set(productionScript.script, productionScript);
  }
  return [...scripts.values()];
}

/**
 * The steps of the scripts only the apps define, which a turborepo root does not forward: one line per app that has
 * the script, app by app, each app in the order `scriptsOf` gives, so every app's sequence runs as printed. The
 * sentence of each line ends with the app name.
 */
export function appOnlyScriptSteps(
  ctx: TemplateContext,
  scriptsOf: (app: AppContext) => ScriptDescription[],
): ScriptStep[] {
  const rootScripts = getRootScripts(ctx);
  const appScripts = getAppScripts(ctx);

  return ctx.apps.flatMap((app, index) =>
    scriptsOf(app)
      .filter(({ script }) => !(script in rootScripts) && script in (appScripts[index]?.scripts ?? {}))
      .map(({ script, description }) => ({
        description: `${description} (${app.appName})`,
        command: getScriptCommandInApp(ctx, script, app.appName),
      })),
  );
}

/**
 * The production commands the project defines: the README, AGENTS.md and the CLI summary print them. A script the
 * root defines runs from the root, in the order the stacks of the apps and the addons declare. A script only the
 * apps define gets a line per app that has it (`appOnlyScriptSteps`), each app in its own declared order (its stack,
 * then the addons).
 */
export function collectProductionSteps(ctx: TemplateContext): ScriptStep[] {
  const rootScripts = getRootScripts(ctx);

  const rootSteps = declaredProductionScripts(
    ctx,
    ctx.apps.map((app) => app.stackName),
  )
    .filter(({ script }) => script in rootScripts)
    .map(({ script, description }) => ({ description, command: getScriptCommand(ctx, script) }));

  const appSteps = appOnlyScriptSteps(ctx, (app) => declaredProductionScripts(ctx, [app.stackName]));

  return [...rootSteps, ...appSteps];
}
