// @ts-nocheck -- skip type checking
import * as d_docs_6 from '../content/docs/stacks/nextjs.mdx?collection=docs';
import * as d_docs_5 from '../content/docs/stacks/hono.mdx?collection=docs';
import * as d_docs_4 from '../content/docs/stacks/expo.mdx?collection=docs';
import * as d_docs_3 from '../content/docs/why.mdx?collection=docs';
import * as d_docs_2 from '../content/docs/options.mdx?collection=docs';
import * as d_docs_1 from '../content/docs/index.mdx?collection=docs';
import * as d_docs_0 from '../content/docs/cli.mdx?collection=docs';
import { _runtime } from 'fumadocs-mdx/runtime/next';
import * as _source from '../source.config';
export const docs = _runtime.docs<typeof _source.docs>(
  [
    { info: { path: 'cli.mdx', fullPath: 'content/docs/cli.mdx' }, data: d_docs_0 },
    { info: { path: 'index.mdx', fullPath: 'content/docs/index.mdx' }, data: d_docs_1 },
    { info: { path: 'options.mdx', fullPath: 'content/docs/options.mdx' }, data: d_docs_2 },
    { info: { path: 'why.mdx', fullPath: 'content/docs/why.mdx' }, data: d_docs_3 },
    { info: { path: 'stacks/expo.mdx', fullPath: 'content/docs/stacks/expo.mdx' }, data: d_docs_4 },
    { info: { path: 'stacks/hono.mdx', fullPath: 'content/docs/stacks/hono.mdx' }, data: d_docs_5 },
    { info: { path: 'stacks/nextjs.mdx', fullPath: 'content/docs/stacks/nextjs.mdx' }, data: d_docs_6 },
  ],
  [
    {
      info: { path: 'meta.json', fullPath: 'content/docs/meta.json' },
      data: {
        title: 'Documentation',
        pages: [
          '---Introduction---',
          'index',
          'why',
          'cli',
          'options',
          '---Stacks---',
          'stacks/nextjs',
          'stacks/expo',
          'stacks/hono',
        ],
        description: 'Documentation for the project',
        root: true,
      },
    },
  ],
);
