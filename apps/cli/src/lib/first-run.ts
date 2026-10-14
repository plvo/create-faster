import { META } from '@/__meta__';
import { getProjectAddon } from '@/lib/addon-utils';
import { collectEnvGroups } from '@/lib/env-generator';
import { getScriptCommand } from '@/lib/package-manager';
import type { TemplateContext } from '@/types/ctx';
import type { FirstRunCommand, FirstRunStep, ProjectCategoryName } from '@/types/meta';

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

function collectAddonSteps(ctx: TemplateContext): FirstRunStep[] {
  const categories = Object.keys(META.project) as ProjectCategoryName[];

  return categories.flatMap((category) => {
    const selection = ctx.project[category];
    const names = Array.isArray(selection) ? selection : selection ? [selection] : [];
    return names.flatMap((name) => getProjectAddon(category, name)?.firstRun ?? []);
  });
}

/** The commands a fresh project runs before `dev`, in order: the README and the CLI summary both print them. */
export function collectFirstRunSteps(ctx: TemplateContext): ResolvedFirstRunStep[] {
  const blueprintSteps = ctx.blueprint ? META.blueprints[ctx.blueprint]?.firstRun : undefined;
  const steps = blueprintSteps ?? collectAddonSteps(ctx);

  return [
    ...collectEnvStep(ctx),
    ...steps.map(({ description, commands }) => ({
      description,
      commands: commands.map((command) => resolveCommand(ctx, command)),
    })),
  ];
}
