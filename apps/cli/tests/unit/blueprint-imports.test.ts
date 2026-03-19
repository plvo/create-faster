import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { META } from '@/__meta__';
import { generateAppPackageJson } from '@/lib/package-json-generator';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';

/**
 * Strips Handlebars `{{#if (isMono)}}` / `{{else}}` / `{{/if}}` blocks
 * that wouldn't render for the given repo type, so we only check imports
 * that will actually appear in the generated output.
 */
function getEffectiveContent(content: string, isMono: boolean): string {
  const lines = content.split('\n');
  const result: string[] = [];

  const stack: { isMonoBlock: boolean; skipping: boolean }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('{{#if')) {
      const isMonoBlock = trimmed === '{{#if (isMono)}}';
      stack.push({ isMonoBlock, skipping: isMonoBlock ? !isMono : false });
      continue;
    }

    if (trimmed === '{{else}}' && stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.isMonoBlock) {
        top.skipping = !top.skipping;
      }
      continue;
    }

    if (trimmed === '{{/if}}' && stack.length > 0) {
      stack.pop();
      continue;
    }

    if (stack.some((frame) => frame.isMonoBlock && frame.skipping)) continue;

    result.push(line);
  }

  return result.join('\n');
}

function extractAtSlashImports(content: string): string[] {
  const imports: string[] = [];
  const regex = /from\s+['"](@\/[^'"]+)['"]/g;
  for (const match of content.matchAll(regex)) {
    imports.push(match[1]);
  }
  return [...new Set(imports)];
}

function extractExternalPackageImports(content: string): string[] {
  const packages = new Set<string>();

  const patterns = [/\bimport\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/g, /\bimport\s+['"]([^'"]+)['"]/g];

  for (const regex of patterns) {
    for (const match of content.matchAll(regex)) {
      const importPath = match[1];

      if (
        importPath.startsWith('.') ||
        importPath.startsWith('#') ||
        importPath.startsWith('@/') ||
        importPath.startsWith('@repo/') ||
        importPath.startsWith('node:') ||
        importPath.startsWith('bun:') ||
        importPath.includes('{{')
      ) {
        continue;
      }

      const packageName = importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0];

      packages.add(packageName);
    }
  }

  return [...packages];
}

function buildContextFromBlueprint(name: string): TemplateContext {
  const blueprint = META.blueprints[name];
  return {
    projectName: 'test',
    repo: blueprint.context.apps.length > 1 ? 'turborepo' : 'single',
    apps: blueprint.context.apps.map((app) => ({
      appName: app.appName,
      stackName: app.stackName,
      libraries: [...app.libraries],
    })),
    project: {
      ...blueprint.context.project,
      tooling: [],
    },
    git: false,
    blueprint: name,
  };
}

describe('Blueprint template @/ imports', () => {
  for (const blueprintName of Object.keys(META.blueprints)) {
    test(`all @/ imports in "${blueprintName}" resolve to generated files`, () => {
      const ctx = buildContextFromBlueprint(blueprintName);
      const isMono = ctx.repo === 'turborepo';
      const templates = getAllTemplatesForContext(ctx);
      const destinations = new Set(templates.map((t) => t.destination));

      const unresolved: { file: string; importPath: string }[] = [];

      for (const template of templates) {
        if (!template.source.includes(`blueprints/${blueprintName}`)) continue;

        const rawContent = readFileSync(template.source, 'utf-8');
        const content = getEffectiveContent(rawContent, isMono);
        const atImports = extractAtSlashImports(content);

        const appMatch = template.destination.match(/^apps\/([^/]+)\//);
        const pkgMatch = template.destination.match(/^packages\/([^/]+)\//);

        let srcPrefix: string;
        if (appMatch) {
          srcPrefix = `apps/${appMatch[1]}/src/`;
        } else if (pkgMatch) {
          srcPrefix = `packages/${pkgMatch[1]}/src/`;
        } else {
          srcPrefix = 'src/';
        }

        for (const importPath of atImports) {
          const relativePath = importPath.replace(/^@\//, '');
          const candidates = [
            `${srcPrefix}${relativePath}.ts`,
            `${srcPrefix}${relativePath}.tsx`,
            `${srcPrefix}${relativePath}/index.ts`,
            `${srcPrefix}${relativePath}/index.tsx`,
          ];

          if (!candidates.some((c) => destinations.has(c))) {
            unresolved.push({ file: template.destination, importPath });
          }
        }
      }

      expect(
        unresolved,
        `Unresolved @/ imports in "${blueprintName}":\n${unresolved.map((u) => `  ${u.file} → ${u.importPath}`).join('\n')}`,
      ).toEqual([]);
    });
  }
});

describe('Blueprint template relative imports', () => {
  for (const blueprintName of Object.keys(META.blueprints)) {
    test(`all relative imports in "${blueprintName}" resolve to generated files`, () => {
      const ctx = buildContextFromBlueprint(blueprintName);
      const isMono = ctx.repo === 'turborepo';
      const templates = getAllTemplatesForContext(ctx);
      const destinations = new Set(templates.map((t) => t.destination));

      const unresolved: { file: string; importPath: string }[] = [];

      for (const template of templates) {
        if (!template.source.includes(`blueprints/${blueprintName}`)) continue;

        const rawContent = readFileSync(template.source, 'utf-8');
        const content = getEffectiveContent(rawContent, isMono);

        const regex = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
        const relativeImports = [...new Set([...content.matchAll(regex)].map((m) => m[1]))];

        const dir = dirname(template.destination);

        for (const importPath of relativeImports) {
          const resolved = normalize(join(dir, importPath));
          const candidates = [
            `${resolved}.ts`,
            `${resolved}.tsx`,
            `${resolved}/index.ts`,
            `${resolved}/index.tsx`,
            resolved,
          ];

          if (!candidates.some((c) => destinations.has(c))) {
            unresolved.push({ file: template.destination, importPath });
          }
        }
      }

      expect(
        unresolved,
        `Unresolved relative imports in "${blueprintName}":\n${unresolved.map((u) => `  ${u.file} → ${u.importPath}`).join('\n')}`,
      ).toEqual([]);
    });
  }
});

describe('Blueprint template external dependencies', () => {
  for (const blueprintName of Object.keys(META.blueprints)) {
    test(`external imports in "${blueprintName}" app templates have deps declared`, () => {
      const ctx = buildContextFromBlueprint(blueprintName);
      const isMono = ctx.repo === 'turborepo';
      const templates = getAllTemplatesForContext(ctx);

      const appDeps = new Map<string, Set<string>>();
      for (const [i, app] of ctx.apps.entries()) {
        const pkg = generateAppPackageJson(app, ctx, i);
        const deps = new Set<string>();
        for (const dep of Object.keys(pkg.content.dependencies ?? {})) deps.add(dep);
        for (const dep of Object.keys(pkg.content.devDependencies ?? {})) deps.add(dep);
        appDeps.set(app.appName, deps);
      }

      const undeclared: { file: string; pkg: string; app: string }[] = [];

      for (const template of templates) {
        if (!template.source.includes(`blueprints/${blueprintName}`)) continue;

        const appMatch = template.destination.match(/^apps\/([^/]+)\//);
        if (!appMatch) continue;

        const appName = appMatch[1];
        const deps = appDeps.get(appName);
        if (!deps) continue;

        const rawContent = readFileSync(template.source, 'utf-8');
        const content = getEffectiveContent(rawContent, isMono);
        const externalImports = extractExternalPackageImports(content);

        for (const pkg of externalImports) {
          if (!deps.has(pkg)) {
            undeclared.push({ file: template.destination, pkg, app: appName });
          }
        }
      }

      expect(
        undeclared,
        `Undeclared external deps in "${blueprintName}" app templates:\n${undeclared.map((u) => `  ${u.file} → ${u.pkg} (not in ${u.app} deps)`).join('\n')}`,
      ).toEqual([]);
    });
  }
});
