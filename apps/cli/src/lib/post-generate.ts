import { getSelectedProjectAddons } from '@/lib/addon-utils';
import { getScriptCommand } from '@/lib/package-manager';
import type { TemplateContext } from '@/types/ctx';

export interface ResolvedPostGenerateStep {
  description: string;
  command: string;
}

/** The commands the CLI runs once the dependencies are installed, in order: one per `postGenerate` script of the selected addons. */
export function collectPostGenerateSteps(ctx: TemplateContext): ResolvedPostGenerateStep[] {
  return getSelectedProjectAddons(ctx).flatMap((addon) =>
    (addon.postGenerate ?? []).map(({ description, script }) => ({
      description,
      command: getScriptCommand(ctx, script),
    })),
  );
}

/** Whether the CLI installs the dependencies itself: a package manager is selected and `--no-install` is absent. */
export function installsDependencies(ctx: TemplateContext): boolean {
  return Boolean(ctx.pm) && !ctx.skipInstall;
}

/** The `postGenerate` steps the user runs: all of them when the CLI does not install, none when it runs them itself. */
export function collectManualPostGenerateSteps(ctx: TemplateContext): ResolvedPostGenerateStep[] {
  return installsDependencies(ctx) ? [] : collectPostGenerateSteps(ctx);
}
