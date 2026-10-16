import { META } from '@/__meta__';
import { getSelectedProjectAddons } from '@/lib/addon-utils';
import { collectEnvGroups, collectGeneratedEnvs } from '@/lib/env-generator';
import { getScriptCommand } from '@/lib/package-manager';
import type { TemplateContext } from '@/types/ctx';
import type { FirstRunCommand, FirstRunStep } from '@/types/meta';

interface ResolvedFirstRunStep {
  description: string;
  commands: string[];
}

function resolveCommand(ctx: TemplateContext, step: FirstRunCommand): string {
  return 'script' in step ? getScriptCommand(ctx, step.script) : step.command;
}

function collectEnvStep(ctx: TemplateContext): ResolvedFirstRunStep[] {
  const groups = collectEnvGroups(ctx);
  if (groups.length === 0) return [];

  return [
    {
      description: 'Set up environment variables',
      commands: groups.map(({ path }) => `cp ${path}.example ${path}`),
    },
  ];
}

function collectGenerateSteps(ctx: TemplateContext): ResolvedFirstRunStep[] {
  return collectGeneratedEnvs(ctx).map(({ name, command, paths }) => ({
    description: `Generate ${name} and set it in ${paths.join(', ')}`,
    commands: [command],
  }));
}

function collectAddonSteps(ctx: TemplateContext): FirstRunStep[] {
  return getSelectedProjectAddons(ctx).flatMap((addon) => addon.firstRun ?? []);
}

/** The commands a fresh project runs before `dev`, in order: the README and the CLI summary both print them. */
export function collectFirstRunSteps(ctx: TemplateContext): ResolvedFirstRunStep[] {
  const blueprintSteps = ctx.blueprint ? META.blueprints[ctx.blueprint]?.firstRun : undefined;
  const steps = blueprintSteps ?? collectAddonSteps(ctx);

  return [
    ...collectEnvStep(ctx),
    ...collectGenerateSteps(ctx),
    ...steps.map(({ description, commands }) => ({
      description,
      commands: commands.map((command) => resolveCommand(ctx, command)),
    })),
  ];
}
