import { META } from '@/__meta__';
import { getAppScripts } from '@/lib/package-json-generator';
import { appOnlyScriptSteps, type ScriptStep } from '@/lib/production-steps';
import type { TemplateContext } from '@/types/ctx';

/**
 * The interactive scripts (`interactiveScripts` of a stack) that an app defines and the root does not: a turborepo
 * root never forwards them through turbo, so the README, AGENTS.md and the CLI summary print one command per app,
 * run from its directory in a terminal of its own.
 */
export function collectInteractiveSteps(ctx: TemplateContext): ScriptStep[] {
  return appOnlyScriptSteps(ctx, (app) =>
    (META.stacks[app.stackName].interactiveScripts ?? []).map((script) => ({
      script,
      description: `Run ${script} in a terminal of its own`,
    })),
  );
}

/** The interactive script of a stack that the app defines, or undefined: a single repo keeps the plain script. */
export function getInteractiveScript(ctx: TemplateContext, appName: string): string | undefined {
  const index = ctx.apps.findIndex((app) => app.appName === appName);
  const app = ctx.apps[index];
  if (!app) return undefined;
  const scripts = getAppScripts(ctx)[index]?.scripts ?? {};
  return (META.stacks[app.stackName].interactiveScripts ?? []).find((script) => script in scripts);
}
