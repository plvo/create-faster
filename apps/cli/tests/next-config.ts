import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

const MDX_PLUGIN = 'export default () => (config) => config;';

interface EvaluatedNextConfig {
  output?: string;
  images?: { unoptimized?: boolean };
}

/**
 * Evaluates a generated `next.config.ts` the way `next dev` (`development`) and `next build` (`production`) load it.
 * `process.env.NODE_ENV` is defined at transpile time, as Bun would otherwise inline the value of the test run, and the
 * MDX plugin is a pass-through. Each call writes the module to its own directory under `directory`, so each load is fresh.
 */
export async function evaluateNextConfig(
  source: string,
  directory: string,
  nodeEnv: 'development' | 'production',
): Promise<EvaluatedNextConfig> {
  const workDirectory = await mkdtemp(join(directory, 'next-config-'));
  const mdxPath = join(workDirectory, 'mdx-plugin.mjs');
  await Bun.write(mdxPath, MDX_PLUGIN);
  const compiled = new Bun.Transpiler({
    loader: 'ts',
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
  }).transformSync(source);
  const target = join(workDirectory, 'next.config.mjs');
  await Bun.write(target, compiled.replace(/(["'])@next\/mdx\1/g, JSON.stringify(mdxPath)));
  return ((await import(target)) as { default: EvaluatedNextConfig }).default;
}
