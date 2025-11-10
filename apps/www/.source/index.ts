// @ts-nocheck -- skip type checking
import * as d_docs_14 from '../content/docs/database/postgresql.mdx?collection=docs';
import * as d_docs_13 from '../content/docs/database/mysql.mdx?collection=docs';
import * as d_docs_12 from '../content/docs/extras/husky.mdx?collection=docs';
import * as d_docs_11 from '../content/docs/extras/biomejs.mdx?collection=docs';
import * as d_docs_10 from '../content/docs/orm/prisma.mdx?collection=docs';
import * as d_docs_9 from '../content/docs/orm/drizzle.mdx?collection=docs';
import * as d_docs_8 from '../content/docs/stacks/nextjs.mdx?collection=docs';
import * as d_docs_7 from '../content/docs/stacks/hono.mdx?collection=docs';
import * as d_docs_6 from '../content/docs/stacks/expo.mdx?collection=docs';
import * as d_docs_5 from '../content/docs/why.mdx?collection=docs';
import * as d_docs_4 from '../content/docs/roadmap.mdx?collection=docs';
import * as d_docs_3 from '../content/docs/options.mdx?collection=docs';
import * as d_docs_2 from '../content/docs/index.mdx?collection=docs';
import * as d_docs_1 from '../content/docs/cli.mdx?collection=docs';
import * as d_docs_0 from '../content/docs/changelog.mdx?collection=docs';
import { _runtime } from 'fumadocs-mdx/runtime/next';
import * as _source from '../source.config';
export const docs = _runtime.docs<typeof _source.docs>(
  [
    { info: { path: 'changelog.mdx', fullPath: 'content/docs/changelog.mdx' }, data: d_docs_0 },
    { info: { path: 'cli.mdx', fullPath: 'content/docs/cli.mdx' }, data: d_docs_1 },
    { info: { path: 'index.mdx', fullPath: 'content/docs/index.mdx' }, data: d_docs_2 },
    { info: { path: 'options.mdx', fullPath: 'content/docs/options.mdx' }, data: d_docs_3 },
    { info: { path: 'roadmap.mdx', fullPath: 'content/docs/roadmap.mdx' }, data: d_docs_4 },
    { info: { path: 'why.mdx', fullPath: 'content/docs/why.mdx' }, data: d_docs_5 },
    { info: { path: 'stacks/expo.mdx', fullPath: 'content/docs/stacks/expo.mdx' }, data: d_docs_6 },
    { info: { path: 'stacks/hono.mdx', fullPath: 'content/docs/stacks/hono.mdx' }, data: d_docs_7 },
    { info: { path: 'stacks/nextjs.mdx', fullPath: 'content/docs/stacks/nextjs.mdx' }, data: d_docs_8 },
    { info: { path: 'orm/drizzle.mdx', fullPath: 'content/docs/orm/drizzle.mdx' }, data: d_docs_9 },
    { info: { path: 'orm/prisma.mdx', fullPath: 'content/docs/orm/prisma.mdx' }, data: d_docs_10 },
    { info: { path: 'extras/biomejs.mdx', fullPath: 'content/docs/extras/biomejs.mdx' }, data: d_docs_11 },
    { info: { path: 'extras/husky.mdx', fullPath: 'content/docs/extras/husky.mdx' }, data: d_docs_12 },
    { info: { path: 'database/mysql.mdx', fullPath: 'content/docs/database/mysql.mdx' }, data: d_docs_13 },
    { info: { path: 'database/postgresql.mdx', fullPath: 'content/docs/database/postgresql.mdx' }, data: d_docs_14 },
  ],
  [
    {
      info: { path: 'meta.json', fullPath: 'content/docs/meta.json' },
      data: {
        title: 'Documentation',
        pages: [
          '---INTRODUCTION---',
          'index',
          'why',
          'cli',
          'options',
          'roadmap',
          'changelog',
          '---STACKS---',
          'stacks/nextjs',
          'stacks/expo',
          'stacks/hono',
          '---DATABASES---',
          'database/postgresql',
          'database/mysql',
          '---ORMS---',
          'orm/drizzle',
          'orm/prisma',
          '---EXTRAS---',
          'extras/biomejs',
          'extras/husky',
        ],
        description: 'Documentation for the project',
        root: true,
      },
    },
  ],
);
