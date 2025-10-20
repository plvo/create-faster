import { Glob } from 'bun';
import { META } from '@/__meta__';
import type { Category, Scope, TemplateContext } from '@/types';

/**
 * Scanne tous les fichiers .hbs dans un dossier de templates
 */
function scanTemplates(category: Category, stack: string): string[] {
  const dir = `${import.meta.dir}/../../templates/${category}/${stack}`;
  const glob = new Glob('**/*.hbs');

  return Array.from(glob.scanSync({ cwd: dir })).map((f) => f.toString());
}

/**
 * Résout le chemin de destination selon le scope et le contexte
 */
function resolveDestination(relativePath: string, category: Category, scope: Scope, context: TemplateContext): string {
  // Enlever extension .hbs
  const cleanPath = relativePath.replace('.hbs', '');

  if (context.repo === 'single') {
    return cleanPath;
  }

  // turborepo
  switch (scope) {
    case 'app': {
      // Déterminer le bon appName selon la catégorie
      let appName = 'app';
      if (category === 'framework' && context.framework) {
        appName = context.framework.appName;
      } else if (category === 'backend' && context.backend) {
        appName = context.backend.appName;
      }
      return `apps/${appName}/${cleanPath}`;
    }
    case 'package': {
      const packageName = META[category].packageName || 'shared';
      return `packages/${packageName}/${cleanPath}`;
    }
    case 'root':
      return cleanPath;
  }
}

/**
 * Liste tous les templates à générer pour une stack donnée
 */
export function getTemplatesForStack(
  category: Category,
  stack: string,
  context: TemplateContext,
): Array<{ source: string; destination: string }> {
  const categoryMeta = META[category];

  if (!categoryMeta || !categoryMeta.stacks[stack]) {
    return [];
  }

  try {
    const files = scanTemplates(category, stack);
    const scope = categoryMeta.scope;

    return files.map((file) => ({
      source: `templates/${category}/${stack}/${file}`,
      destination: resolveDestination(file, category, scope, context),
    }));
  } catch {
    // Si le dossier n'existe pas, retourner tableau vide
    return [];
  }
}

/**
 * Liste tous les templates à générer selon le contexte complet
 */
export function getAllTemplatesForContext(context: TemplateContext): Array<{ source: string; destination: string }> {
  const result: Array<{ source: string; destination: string }> = [];

  // Framework
  if (context.framework) {
    result.push(...getTemplatesForStack('framework', context.framework.stack, context));
  }

  // Backend
  if (context.backend) {
    result.push(...getTemplatesForStack('backend', context.backend.stack, context));
  }

  // ORM
  if (context.orm) {
    result.push(...getTemplatesForStack('orm', context.orm, context));
  }

  // Database
  if (context.database) {
    result.push(...getTemplatesForStack('database', context.database, context));
  }

  // Extras
  if (context.extras) {
    for (const extra of context.extras) {
      result.push(...getTemplatesForStack('extras', extra, context));
    }
  }

  return result;
}
