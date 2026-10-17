import { META } from '@/__meta__';
import { getSelectedProjectAddons } from '@/lib/addon-utils';
import { getAppScripts, getRootScripts } from '@/lib/package-json-generator';
import { getScriptCommand, getScriptCommandInApp } from '@/lib/package-manager';
import { resolveConditionals } from '@/lib/when';
import type { TemplateContext } from '@/types/ctx';
import type { DescribedScript } from '@/types/meta';
import type { StackName } from '@/types/stack-name';
import type { Conditional } from '@/types/when';

interface ScriptStep {
  description: string;
  command: string;
}

type ScriptsField = 'productionScripts' | 'developmentScripts';

/** The scripts of a field that the given stacks and the selected addons declare, stacks first. */
const declaredScripts = (
  ctx: TemplateContext,
  stacks: StackName[],
  field: ScriptsField,
): Conditional<DescribedScript>[] => [
  ...stacks.flatMap((stack) => META.stacks[stack][field] ?? []),
  ...getSelectedProjectAddons(ctx).flatMap((addon) => addon[field] ?? []),
];

function uniqueScripts(ctx: TemplateContext, declared: Conditional<DescribedScript>[]): DescribedScript[] {
  const scripts = new Map<string, DescribedScript>();
  for (const declaredScript of resolveConditionals(declared, ctx)) {
    const { script, description } = declaredScript;
    if (script !== undefined && description !== undefined && !scripts.has(script)) {
      scripts.set(script, { script, description });
    }
  }
  return [...scripts.values()];
}

/**
 * The commands of the declared scripts the project defines. A script the root defines runs from the root, in the
 * order the stacks of the apps and the addons declare. A script only the apps define gets a line per app that has
 * it, app by app, each app in its own declared order (its stack, then the addons), so every app's sequence runs as
 * printed.
 */
function collectSteps(ctx: TemplateContext, field: ScriptsField): ScriptStep[] {
  const rootScripts = getRootScripts(ctx);
  const appScripts = getAppScripts(ctx);

  const rootSteps = uniqueScripts(
    ctx,
    declaredScripts(
      ctx,
      ctx.apps.map((app) => app.stackName),
      field,
    ),
  )
    .filter(({ script }) => script in rootScripts)
    .map(({ script, description }) => ({ description, command: getScriptCommand(ctx, script) }));

  const appSteps = ctx.apps.flatMap((app, index) =>
    uniqueScripts(ctx, declaredScripts(ctx, [app.stackName], field))
      .filter(({ script }) => !(script in rootScripts) && script in (appScripts[index]?.scripts ?? {}))
      .map(({ script, description }) => ({
        description: `${description} (${app.appName})`,
        command: getScriptCommandInApp(ctx, script, app.appName),
      })),
  );

  return [...rootSteps, ...appSteps];
}

/** The production commands the project defines: the README, AGENTS.md and the CLI summary print them. */
export function collectProductionSteps(ctx: TemplateContext): ScriptStep[] {
  return collectSteps(ctx, 'productionScripts');
}

/** The commands that start an app the root `dev` does not: the README, AGENTS.md and the CLI summary print them. */
export function collectDevelopmentSteps(ctx: TemplateContext): ScriptStep[] {
  return collectSteps(ctx, 'developmentScripts');
}
