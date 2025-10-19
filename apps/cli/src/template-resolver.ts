import stackMetaJson from '#/_stack-meta.json';

type StackMeta = typeof stackMetaJson;
type Category = keyof StackMeta['templates'];
type StackForCategory<C extends Category> = keyof StackMeta['templates'][C];

export interface TemplateContext {
  repo: keyof StackMeta['templates']['repo'];
  framework?: keyof StackMeta['templates']['frameworks'];
  backend?: keyof StackMeta['templates']['backend'];
  orm?: keyof StackMeta['templates']['orm'];
  database?: keyof StackMeta['templates']['database'];
  extras?: (keyof StackMeta['templates']['extras'])[];
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
  const templates: StackMeta['templates'] = stackMetaJson.templates;
  const categoryMeta: StackMeta['templates'][C] = templates[category];

  if (!categoryMeta) {
    throw new Error(`Category not found: ${category}`);
  }

  const stackData = categoryMeta[stack];
  if (!stackData) {
    throw new Error(`Stack not found: ${category}/${String(stack)}`);
  }

  const fileMeta = (stackData as Record<string, Record<string, string>>)[filename];
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
  const templates = stackMetaJson.templates as StackMeta['templates'];
  const categoryMeta = templates[category];

  if (!categoryMeta) {
    return [];
  }

  const stackData = categoryMeta[stack];
  if (!stackData) {
    return [];
  }

  const result: Array<{ source: string; destination: string }> = [];

  for (const filename of Object.keys(stackData)) {
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
    result.push(...getTemplatesForStack('frameworks', context.framework, context));
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

  // Repo (turborepo setup)
  if (context.repo === 'turborepo') {
    result.push(...getTemplatesForStack('repo', 'turborepo', context));
  }

  // Extras
  if (context.extras) {
    for (const extra of context.extras) {
      result.push(...getTemplatesForStack('extras', extra as keyof StackMeta['templates']['extras'], context));
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
