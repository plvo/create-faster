import { META } from '@/__meta__';
import { getCategoryOptionUnavailability, isLibraryCompatible, isRequirementMet } from '@/lib/addon-utils';
import type { TemplateContext } from '@/types/ctx';
import type { AddonRequire, MetaAddon, ProjectCategoryName } from '@/types/meta';
import type { StackName } from '@/types/stack-name';

/** The choices of META, packed into as few projects as their requirements allow. */
interface ProjectChoices {
  apps: Map<StackName, string[]>;
  database?: string;
  orm?: string;
  deployment?: string;
  linter?: string;
  tooling: string[];
}

type Choice =
  | { kind: 'library'; stack: StackName; name: string }
  | { kind: 'option'; category: ProjectCategoryName; name: string };

/** Deployment first, since a database or a library can require one; libraries last, since they require the rest. */
const CATEGORY_ORDER: ProjectCategoryName[] = ['deployment', 'database', 'orm', 'linter', 'tooling'];
const SINGLE_VALUED = ['database', 'orm', 'deployment', 'linter'] as const;

export function listChoices(): Choice[] {
  const options = CATEGORY_ORDER.flatMap((category) =>
    Object.keys(META.project[category].options).map((name): Choice => ({ kind: 'option', category, name })),
  );
  const libraries = Object.entries(META.libraries).flatMap(([name, library]) =>
    (Object.keys(META.stacks) as StackName[])
      .filter((stack) => isLibraryCompatible(library, stack))
      .map((stack): Choice => ({ kind: 'library', stack, name })),
  );
  return [...options, ...libraries];
}

/** A project needs an app, so every one starts with a Next.js app. */
function emptyProject(): ProjectChoices {
  return { apps: new Map([['nextjs', []]]), tooling: [] };
}

function copy(project: ProjectChoices): ProjectChoices {
  return { ...project, apps: new Map([...project.apps].map(([stack, libraries]) => [stack, [...libraries]])), tooling: [...project.tooling] };
}

function addonOf(choice: Choice): MetaAddon | undefined {
  return choice.kind === 'library' ? META.libraries[choice.name] : META.project[choice.category].options[choice.name];
}

/** Fills what a choice requires and the project leaves open, with the first value the requirement accepts. */
function satisfyRequirement(project: ProjectChoices, require: AddonRequire | undefined): void {
  if (!require) return;
  for (const category of SINGLE_VALUED) {
    const wanted = require[category];
    if (wanted && !project[category]) {
      project[category] = Array.isArray(wanted) ? wanted[0] : Object.keys(META.project[category].options)[0];
    }
  }
  if (require.stacks && ![...project.apps.keys()].some((stack) => require.stacks?.includes(stack))) {
    const [stack] = require.stacks;
    if (stack) project.apps.set(stack, []);
  }
}

function withChoice(project: ProjectChoices, choice: Choice): ProjectChoices | undefined {
  const next = copy(project);
  satisfyRequirement(next, addonOf(choice)?.require);

  if (choice.kind === 'library') {
    next.apps.set(choice.stack, [...(next.apps.get(choice.stack) ?? []), choice.name]);
    return next;
  }
  if (choice.category === 'tooling') {
    if (!next.tooling.includes(choice.name)) next.tooling.push(choice.name);
    return next;
  }
  if (next[choice.category] && next[choice.category] !== choice.name) return undefined;
  next[choice.category] = choice.name;
  return next;
}

function toContext(project: ProjectChoices): TemplateContext {
  return {
    projectName: 'project',
    repo: project.apps.size > 1 ? 'turborepo' : 'single',
    apps: [...project.apps].map(([stackName, libraries]) => ({ appName: stackName, stackName, libraries })),
    project: {
      database: project.database,
      orm: project.orm,
      deployment: project.deployment,
      linter: project.linter,
      tooling: project.tooling,
    },
    git: true,
    pm: 'pnpm',
  };
}

function isValid(project: ProjectChoices): boolean {
  const ctx = toContext(project);
  if (ctx.project.orm && !ctx.project.database) return false;

  const librariesValid = ctx.apps.every((app) =>
    app.libraries.every((name) => isRequirementMet(META.libraries[name]?.require, ctx)),
  );
  const optionsValid = CATEGORY_ORDER.every((category) => {
    const selected = ctx.project[category];
    const names = Array.isArray(selected) ? selected : selected ? [selected] : [];
    return names.every(
      (name) =>
        getCategoryOptionUnavailability(category, name, META.project[category].options[name], ctx) === undefined,
    );
  });
  return librariesValid && optionsValid;
}

/** First fit: each choice joins the first project it is valid in, else starts a new one. Throws on a choice no project can hold. */
export function groupChoices(choices: Choice[] = listChoices()): ProjectChoices[] {
  const projects: ProjectChoices[] = [];

  for (const choice of choices) {
    const fitted = projects
      .map((project) => withChoice(project, choice))
      .findIndex((candidate) => candidate !== undefined && isValid(candidate));
    if (fitted !== -1) {
      projects[fitted] = withChoice(projects[fitted] as ProjectChoices, choice) as ProjectChoices;
      continue;
    }

    const started = withChoice(emptyProject(), choice);
    if (!started || !isValid(started)) {
      throw new Error(`No project can hold ${JSON.stringify(choice)}`);
    }
    projects.push(started);
  }

  return projects;
}

/** The CLI flags that create the project. */
export function toCliArgs(project: ProjectChoices): string[] {
  const apps = [...project.apps].flatMap(([stack, libraries]) => [
    '--app',
    [stack, stack, ...(libraries.length > 0 ? [libraries.join(',')] : [])].join(':'),
  ]);
  const singles = SINGLE_VALUED.flatMap((category) => (project[category] ? [`--${category}`, project[category]] : []));
  const tooling = project.tooling.flatMap((name) => ['--tooling', name]);
  const needsGit = [project.linter, ...project.tooling].some(
    (name) => name !== undefined && Object.values(META.project).some((category) => category.options[name]?.require?.git),
  );
  return [...apps, ...singles, ...tooling, ...(needsGit ? ['--git'] : [])];
}

export function describeProject(project: ProjectChoices): string {
  const apps = [...project.apps].map(([stack, libraries]) => `${stack}[${libraries.join(',')}]`);
  const rest = [project.database, project.orm, project.deployment, project.linter, ...project.tooling].filter(Boolean);
  return [...apps, ...rest].join(' ');
}
