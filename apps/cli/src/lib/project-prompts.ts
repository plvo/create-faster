import { isProjectCategoryAvailable } from '@/lib/addon-utils';
import type { TemplateContext } from '@/types/ctx';
import type { ProjectCategoryName } from '@/types/meta';

interface PromptMode {
  hasFlags: boolean;
  interactive: boolean;
}

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function isCategoryAnswered(categoryName: ProjectCategoryName, ctx: Pick<TemplateContext, 'project'>): boolean {
  const answer = ctx.project[categoryName];
  return Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
}

/**
 * A category is asked when its requirements are met and no flag answered it.
 * Once flags are passed, nothing is asked outside an interactive terminal so scripted runs never block.
 */
export function shouldPromptCategory(
  categoryName: ProjectCategoryName,
  ctx: Omit<TemplateContext, 'repo'>,
  { hasFlags, interactive }: PromptMode,
): boolean {
  if (hasFlags && !interactive) return false;
  if (isCategoryAnswered(categoryName, ctx)) return false;
  return isProjectCategoryAvailable(categoryName, ctx);
}
