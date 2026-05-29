import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import { TEMPLATES_DIR } from '@/lib/constants';
import { collectEnvGroups } from '@/lib/env-generator';
import { readFrontmatterFile } from '@/lib/frontmatter';
import { renderTemplate } from '@/lib/handlebars';
import type { AppContext, TemplateContext } from '@/types/ctx';

interface AgentContextFile {
  destination: string;
  content: string;
}

interface AgentDocFrontmatter {
  scope?: 'app' | 'root';
  heading?: string;
  order?: number;
}

interface Section {
  destination: string;
  heading: string;
  order: number;
  body: string;
}

const AGENT_DOC_FILENAME = '__agent.md.hbs';

const DEFAULT_ORDER = {
  stack: 10,
  database: 20,
  orm: 30,
  deployment: 35,
  library: 50,
  linter: 80,
  tooling: 90,
} as const;

function renderFiche(
  source: string,
  ctx: TemplateContext,
  enrich: Partial<AppContext>,
): { frontmatter: AgentDocFrontmatter; body: string } | null {
  if (!existsSync(source)) return null;
  const { data, content } = readFrontmatterFile(source);
  const frontmatter = data as unknown as AgentDocFrontmatter;
  const envGroups = collectEnvGroups(ctx);
  const body = renderTemplate(content, { ...ctx, ...enrich, envGroups } as TemplateContext).trim();
  if (!body) return null;
  return { frontmatter, body };
}

function resolveDestination(scope: 'app' | 'root', ctx: TemplateContext, appName?: string): string {
  if (ctx.repo === 'single') return 'AGENTS.md';
  if (scope === 'root') return 'AGENTS.md';
  return appName ? `apps/${appName}/AGENTS.md` : 'AGENTS.md';
}

function singleAppEnrich(ctx: TemplateContext): Partial<AppContext> {
  return ctx.repo === 'single' && ctx.apps[0] ? ctx.apps[0] : {};
}

function collectSections(ctx: TemplateContext): Section[] {
  const sections: Section[] = [];

  const push = (
    source: string,
    defaultScope: 'app' | 'root',
    defaultHeading: string,
    defaultOrder: number,
    ctxForRender: TemplateContext,
    enrich: Partial<AppContext>,
    appName?: string,
  ) => {
    const rendered = renderFiche(source, ctxForRender, enrich);
    if (!rendered) return;
    const scope = rendered.frontmatter.scope ?? defaultScope;
    sections.push({
      destination: resolveDestination(scope, ctx, appName),
      heading: rendered.frontmatter.heading ?? defaultHeading,
      order: rendered.frontmatter.order ?? defaultOrder,
      body: rendered.body,
    });
  };

  for (const app of ctx.apps) {
    const stackFiche = join(TEMPLATES_DIR, 'stack', app.stackName, AGENT_DOC_FILENAME);
    push(stackFiche, 'app', META.stacks[app.stackName].label, DEFAULT_ORDER.stack, ctx, app, app.appName);

    for (const libraryName of app.libraries) {
      const library = META.libraries[libraryName];
      if (!library || !isLibraryCompatible(library, app.stackName)) continue;
      const ficheSource = join(TEMPLATES_DIR, 'libraries', libraryName, AGENT_DOC_FILENAME);
      push(ficheSource, 'app', library.label, DEFAULT_ORDER.library, ctx, app, app.appName);
    }
  }

  const projectEnrich = singleAppEnrich(ctx);
  const projectCategories: { category: keyof typeof META.project; order: number }[] = [
    { category: 'database', order: DEFAULT_ORDER.database },
    { category: 'orm', order: DEFAULT_ORDER.orm },
    { category: 'deployment', order: DEFAULT_ORDER.deployment },
    { category: 'linter', order: DEFAULT_ORDER.linter },
  ];

  for (const { category, order } of projectCategories) {
    const value = ctx.project[category as 'database' | 'orm' | 'deployment' | 'linter'];
    if (!value) continue;
    const addon = META.project[category].options[value];
    if (!addon) continue;
    const ficheSource = join(TEMPLATES_DIR, 'project', category, value, AGENT_DOC_FILENAME);
    push(ficheSource, 'root', addon.label, order, ctx, projectEnrich);
  }

  for (const tooling of ctx.project.tooling) {
    const addon = META.project.tooling.options[tooling];
    if (!addon) continue;
    const ficheSource = join(TEMPLATES_DIR, 'project', 'tooling', tooling, AGENT_DOC_FILENAME);
    push(ficheSource, 'root', addon.label, DEFAULT_ORDER.tooling, ctx, projectEnrich);
  }

  return sections;
}

function renderHeader(ctx: TemplateContext): string {
  const source = join(TEMPLATES_DIR, 'repo', ctx.repo, AGENT_DOC_FILENAME);
  if (!existsSync(source)) return `# ${ctx.projectName}\n`;
  const { content } = readFrontmatterFile(source);
  const envGroups = collectEnvGroups(ctx);
  const enrich = singleAppEnrich(ctx);
  return renderTemplate(content, { ...ctx, ...enrich, envGroups } as TemplateContext).trim();
}

function assembleSections(sections: Section[]): string {
  return [...sections]
    .sort((a, b) => a.order - b.order || a.heading.localeCompare(b.heading))
    .map((s) => `## ${s.heading}\n\n${s.body}`)
    .join('\n\n');
}

export function collectAgentContextFiles(ctx: TemplateContext): AgentContextFile[] {
  const sections = collectSections(ctx);
  const files: AgentContextFile[] = [];

  const header = renderHeader(ctx);
  const rootSections = sections.filter((s) => s.destination === 'AGENTS.md');
  const rootBody = [header, assembleSections(rootSections)].filter(Boolean).join('\n\n');
  files.push({ destination: 'AGENTS.md', content: `${rootBody}\n` });

  const appDestinations = new Set(sections.filter((s) => s.destination !== 'AGENTS.md').map((s) => s.destination));

  for (const destination of appDestinations) {
    const appName = destination.split('/')[1];
    const app = ctx.apps.find((a) => a.appName === appName);
    const preamble = app ? `# ${app.appName}\n\n${META.stacks[app.stackName].label} app.` : `# ${appName}`;
    const appSections = sections.filter((s) => s.destination === destination);
    const body = [preamble, assembleSections(appSections)].filter(Boolean).join('\n\n');
    files.push({ destination, content: `${body}\n` });
  }

  for (const file of files.slice()) {
    if (!file.destination.endsWith('AGENTS.md')) continue;
    const claudePath = file.destination.replace(/AGENTS\.md$/, 'CLAUDE.md');
    files.push({ destination: claudePath, content: '@AGENTS.md\n' });
  }

  return files;
}
