import { type Category, META, type StackForCategory } from '@/__meta__';

export interface TemplateContext {
  repo: StackForCategory<'repo'>;
  framework?: StackForCategory<'framework'>;
  backend?: StackForCategory<'backend'>;
  orm?: StackForCategory<'orm'>;
  database?: StackForCategory<'database'>;
  extras?: StackForCategory<'extras'>[];
}

/**
 * Résout le chemin de destination d'un template selon le contexte
 *
 * Logique de matching :
 * 1. Match exact "single.nextjs" ou "turborepo.nextjs"
 * 2. Wildcard framework "single.*" ou "turborepo.*"
 * 3. Wildcard complet "*"
 */
export function resolveTemplatePath<C extends Category, S extends StackForCategory<C>>(
  category: C,
  stack: S,
  filename: string,
  context: TemplateContext,
): string {
  const categoryMeta = META[category];

  if (!categoryMeta) {
    throw new Error(`Category not found: ${category}`);
  }

  const stackData = categoryMeta[stack];
  if (!stackData) {
    throw new Error(`Stack not found: ${category}/${String(stack)}`);
  }

  const fileMeta = stackData.templates[filename];
  if (!fileMeta) {
    throw new Error(`File not found: ${category}/${String(stack)}/${filename}`);
  }

  const paths = fileMeta as Record<string, string>;
  const slug = context.framework ? `${context.repo}.${context.framework}` : context.repo;

  // 1. Match exact (ex: "single.nextjs" ou "turborepo.nextjs")
  if (paths[slug]) {
    return paths[slug];
  }

  // 2. Wildcard framework (ex: "single.*" ou "turborepo.*")
  const monorepoWildcard = `${context.repo}.*`;
  if (paths[monorepoWildcard]) {
    return paths[monorepoWildcard];
  }

  // 3. Wildcard complet (ex: "*")
  if (paths['*']) {
    return paths['*'];
  }

  throw new Error(`No path mapping found for ${category}/${String(stack)}/${filename} with context: ${slug}`);
}

/**
 * Liste tous les templates à générer pour une stack donnée
 */
export function getTemplatesForStack<C extends Category, S extends StackForCategory<C>>(
  category: C,
  stack: S,
  context: TemplateContext,
): Array<{ source: string; destination: string }> {
  const categoryMeta = META[category];

  if (!categoryMeta) {
    return [];
  }

  const stackData = categoryMeta[stack];
  if (!stackData) {
    return [];
  }

  const result: Array<{ source: string; destination: string }> = [];

  for (const filename of Object.keys(stackData.templates)) {
    try {
      const destination = resolveTemplatePath(category, stack, filename, context);
      const source = `templates/${category}/${String(stack)}/${filename}`;
      result.push({ source, destination });
    } catch {
      // Skip si pas de mapping pour ce contexte
    }
  }

  return result;
}

/**
 * Liste tous les templates à générer selon le contexte complet
 */
export function getAllTemplatesForContext(context: TemplateContext): Array<{ source: string; destination: string }> {
  const result: Array<{ source: string; destination: string }> = [];

  // Framework
  if (context.framework) {
    result.push(...getTemplatesForStack('framework', context.framework, context));
  }

  // Backend
  if (context.backend) {
    result.push(...getTemplatesForStack('backend', context.backend, context));
  }

  // ORM
  if (context.orm) {
    result.push(...getTemplatesForStack('orm', context.orm, context));
  }

  // Database
  if (context.database) {
    result.push(...getTemplatesForStack('database', context.database, context));
  }

  // Repo
  result.push(...getTemplatesForStack('repo', context.repo, context));

  // Extras
  if (context.extras) {
    for (const extra of context.extras) {
      result.push(...getTemplatesForStack('extras', extra, context));
    }
  }

  return result;
}

/**
 * Exemple d'utilisation :
 *
 * const ctx = {
 *   repo: 'turborepo',
 *   framework: 'nextjs',
 *   orm: 'prisma',
 *   extras: ['biome', 'husky']
 * };
 *
 * const dest = resolveTemplatePath('orm', 'prisma', 'schema.prisma.hbs', ctx);
 * // => 'packages/db/prisma/schema.prisma'
 *
 * const allTemplates = getAllTemplatesForContext(ctx);
 * // => [{ source: 'templates/...', destination: '...' }, ...]
 */
