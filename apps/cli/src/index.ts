import { getAllTemplatesForContext, type TemplateContext } from './template-resolver';

console.log('Hello via Bun!');

const ctx: TemplateContext = {
  repo: 'single',
  framework: 'nextjs',
  orm: 'prisma',
  extras: ['biome', 'husky'],
};

const templates = getAllTemplatesForContext(ctx);

console.log(templates);
