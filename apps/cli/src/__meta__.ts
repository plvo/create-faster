export type Category = 'repo' | 'framework' | 'backend' | 'orm' | 'database' | 'extras';

export interface Stack {
  label: string;
  hint?: string;
  requires?: Category[];
  incompatible?: string[];
  templates: Record<string, Record<string, string>>;
}

export type Meta = Record<Category, Record<string, Stack>>;
export type StackForCategory<C extends Category> = keyof Meta[C];

export const META: Meta = {
  repo: {
    single: {
      label: 'Single project',
      hint: 'One app, simple setup',
      templates: {
        'tsconfig.json.hbs': {
          '*': 'tsconfig.json',
        },
      },
    },
    turborepo: {
      label: 'Turborepo',
      hint: 'Monorepo with workspaces',
      templates: {
        'turbo.json.hbs': {
          '*': 'turbo.json',
        },
        'tsconfig.json.hbs': {
          '*': 'tsconfig.json',
        },
      },
    },
  },
  framework: {
    nextjs: {
      label: 'Next.js',
      hint: 'React framework with SSR',
      templates: {
        'next.config.ts.hbs': {
          'single.*': 'next.config.ts',
          'turborepo.*': 'apps/web/next.config.ts',
        },
        'package.json.hbs': {
          'single.*': 'package.json',
          'turborepo.*': 'apps/web/package.json',
        },
      },
    },
  },
  backend: {
    hono: {
      label: 'Hono',
      hint: 'Fast web framework',
      templates: {
        'app.ts.hbs': {
          'single.*': 'src/app.ts',
          'turborepo.*': 'apps/web/src/app.ts',
        },
        'index.ts.hbs': {
          'single.*': 'src/index.ts',
          'turborepo.*': 'apps/web/src/index.ts',
        },
      },
    },
  },
  orm: {
    prisma: {
      label: 'Prisma',
      hint: 'Type-safe ORM with migrations',
      requires: ['database'],
      templates: {
        'schema.prisma.hbs': {
          'single.*': 'prisma/schema.prisma',
          'turborepo.*': 'packages/db/prisma/schema.prisma',
        },
        'client.ts.hbs': {
          'turborepo.*': 'packages/db/src/client.ts',
        },
      },
    },
    drizzle: {
      label: 'Drizzle',
      hint: 'Lightweight TypeScript ORM',
      requires: ['database'],
      templates: {
        'drizle.config.ts.hbs': {
          'single.*': 'drizzle.config.ts',
          'turborepo.*': 'packages/db/drizzle.config.ts',
        },
        'schema.ts.hbs': {
          'single.*': 'src/lib/db/schema.ts',
          'turborepo.*': 'packages/db/src/schema.ts',
        },
        'relations.ts.hbs': {
          'single.*': 'src/lib/db/relations.ts',
          'turborepo.*': 'packages/db/src/relations.ts',
        },
      },
    },
  },
  database: {
    postgres: {
      label: 'PostgreSQL',
      hint: 'Relational database',
      requires: ['orm'],
      templates: {
        'docker-compose.yml.hbs': {
          '*': 'docker-compose.yml',
        },
      },
    },
  },
  extras: {
    biome: {
      label: 'Biome',
      hint: 'Fast linter & formatter',
      templates: {
        'biome.json.hbs': {
          '*': 'biome.json',
        },
      },
    },
    git: {
      label: 'Git',
      hint: 'Version control config',
      templates: {
        '_gitignore.hbs': {
          '*': '.gitignore',
        },
      },
    },
    husky: {
      label: 'Husky',
      hint: 'Git hooks for quality checks',
      templates: {
        'commit-msg.hbs': {
          '*': '.husky/commit-msg',
        },
        'post-commit.hbs': {
          '*': '.husky/post-commit',
        },
        'pre-commit.hbs': {
          '*': '.husky/pre-commit',
        },
      },
    },
  },
} as const;
