import { META } from '@/__meta__';
import { isProjectCategoryAvailable } from '@/lib/addon-utils';
import type { AppContext, FlagAnswers, ProjectContext, TemplateContext } from '@/types/ctx';
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

interface MissingAnswer {
  title: string;
  hint: string;
}

export function isProjectDirAnswered(
  answers: FlagAnswers | undefined,
): answers is FlagAnswers & { projectDir: string } {
  return Boolean(answers?.projectDir);
}

export function areAppsAnswered(answers: FlagAnswers | undefined): answers is FlagAnswers & { apps: AppContext[] } {
  return (answers?.apps?.length ?? 0) > 0;
}

/**
 * The project directory and the apps (or a blueprint, which brings them) have no default: only a prompt
 * can give them when no flag did. Outside an interactive terminal nothing can answer that prompt.
 */
export function missingAnswersWithoutTerminal(
  answers: FlagAnswers | undefined,
  { interactive }: PromptMode,
): MissingAnswer[] {
  if (interactive) return [];

  const missing: MissingAnswer[] = [];
  if (!isProjectDirAnswered(answers)) {
    missing.push({
      title: 'Missing project name',
      hint: 'Pass the project directory as the first argument: create-faster <project-dir>',
    });
  }
  if (!areAppsAnswered(answers)) {
    missing.push({
      title: 'Missing apps',
      hint: 'Pass at least one --app <name:stack:libraries> or a --blueprint <name>',
    });
  }
  return missing;
}

function isCategoryAnswered(categoryName: ProjectCategoryName, ctx: Pick<TemplateContext, 'project'>): boolean {
  const answer = ctx.project[categoryName];
  return Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
}

function isCategoryAskable(
  categoryName: ProjectCategoryName,
  ctx: Pick<TemplateContext, 'project'>,
  mode: PromptMode,
): boolean {
  if (arePromptsSuppressed(mode)) return false;
  if (mode.noSelection.includes(categoryName)) return false;
  return !isCategoryAnswered(categoryName, ctx);
}

/** A category is asked when its requirements are met, no flag answered it and prompts are not suppressed. */
export function shouldPromptCategory(
  categoryName: ProjectCategoryName,
  ctx: Omit<TemplateContext, 'repo'>,
  mode: PromptMode,
): boolean {
  return isCategoryAskable(categoryName, ctx, mode) && isProjectCategoryAvailable(categoryName, ctx);
}

/** The project with each named category given an answer, to ask whether a later category would be available. */
function assumingAnswered(project: ProjectContext, categoryNames: ProjectCategoryName[]): ProjectContext {
  const answers = categoryNames.map((name) => [name, META.project[name].selection === 'multi' ? [name] : name]);
  return { ...project, ...Object.fromEntries(answers) };
}

/**
 * The categories among `categoryNames` that will be asked, in order, as far as the answers so far tell: a category
 * whose requirement is met only by a category asked earlier in the list, or by the one being answered
 * (`answering`), counts as asked.
 */
export function expectedCategoryPrompts(
  categoryNames: ProjectCategoryName[],
  ctx: Omit<TemplateContext, 'repo'>,
  mode: PromptMode,
  answering: ProjectCategoryName[] = [],
): ProjectCategoryName[] {
  const expected: ProjectCategoryName[] = [];
  for (const categoryName of categoryNames) {
    const project = assumingAnswered(ctx.project, [...expected, ...answering]);
    if (isCategoryAskable(categoryName, ctx, mode) && isProjectCategoryAvailable(categoryName, { project })) {
      expected.push(categoryName);
    }
  }
  return expected;
}

export function isGitPrompted(answers: FlagAnswers, mode: PromptMode): boolean {
  return answers.git === undefined && !arePromptsSuppressed(mode);
}

export function isPackageManagerPrompted(answers: FlagAnswers, mode: PromptMode): boolean {
  return !answers.skipInstall && answers.pm === undefined && !arePromptsSuppressed(mode);
}
