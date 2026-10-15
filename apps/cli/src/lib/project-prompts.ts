import { isProjectCategoryAvailable } from '@/lib/addon-utils';
import type { FlagAnswers, TemplateContext } from '@/types/ctx';
import type { ProjectCategoryName } from '@/types/meta';

interface PromptMode {
  hasFlags: boolean;
  interactive: boolean;
  skipPrompts: boolean;
  noSelection: ProjectCategoryName[];
}

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function promptModeOf(answers: FlagAnswers | undefined): PromptMode {
  return {
    hasFlags: Object.keys(answers ?? {}).length > 0,
    interactive: isInteractiveTerminal(),
    skipPrompts: answers?.skipPrompts === true,
    noSelection: answers?.noSelection ?? [],
  };
}

/**
 * Prompts for answers no flag gave are suppressed on request (`--yes`) and, once any flag is passed,
 * outside an interactive terminal, so scripted runs never block.
 */
export function arePromptsSuppressed({ hasFlags, interactive, skipPrompts }: PromptMode): boolean {
  return skipPrompts || (hasFlags && !interactive);
}

function isCategoryAnswered(categoryName: ProjectCategoryName, ctx: Pick<TemplateContext, 'project'>): boolean {
  const answer = ctx.project[categoryName];
  return Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
}

/** A category is asked when its requirements are met, no flag answered it and prompts are not suppressed. */
export function shouldPromptCategory(
  categoryName: ProjectCategoryName,
  ctx: Omit<TemplateContext, 'repo'>,
  mode: PromptMode,
): boolean {
  if (arePromptsSuppressed(mode)) return false;
  if (mode.noSelection.includes(categoryName)) return false;
  if (isCategoryAnswered(categoryName, ctx)) return false;
  return isProjectCategoryAvailable(categoryName, ctx);
}
