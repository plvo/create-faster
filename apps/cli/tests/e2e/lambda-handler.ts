import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './helpers';

export interface LambdaHttpResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

export interface LambdaProbe {
  /** `typeof` the export, `function` for a valid handler. */
  type: string;
  response?: LambdaHttpResponse;
}

// A Lambda function URL request (API Gateway payload v2), what sst.aws.Function with `url: true` receives.
export function functionUrlEvent(path: string): Record<string, unknown> {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: { host: 'example.lambda-url.us-east-1.on.aws' },
    requestContext: {
      domainName: 'example.lambda-url.us-east-1.on.aws',
      http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'e2e' },
    },
    isBase64Encoded: false,
  };
}

const INVOKE_SCRIPT = join(import.meta.dir, 'lambda-invoke.mjs');

/** Bundles a handler file for Node.js as one ESM module, like SST and the Lambda builds do, and returns its path. */
export async function bundleForLambda(entry: string, outDir: string): Promise<string> {
  const result = await Bun.build({ entrypoints: [entry], outdir: outDir, target: 'node', format: 'esm' });
  if (!result.success) throw new AggregateError(result.logs, `Could not bundle ${entry}`);
  const [output] = result.outputs;
  if (!output) throw new Error(`Bundling ${entry} produced no file`);
  return output.path;
}

/** Imports the bundle in a Node.js process and reports its export, calling it with `event` when given. */
export async function probeLambdaHandler(bundle: string, exportName: string, event?: unknown): Promise<LambdaProbe> {
  const workDir = `${bundle}.probe`;
  await mkdir(workDir, { recursive: true });
  const resultPath = join(workDir, `${exportName}.json`);
  const args = ['node', INVOKE_SCRIPT, bundle, exportName, resultPath];

  if (event !== undefined) {
    const eventPath = join(workDir, 'event.json');
    await writeFile(eventPath, JSON.stringify(event));
    args.push(eventPath);
  }

  const result = await runCommand(args, workDir);
  if (result.exitCode !== 0) throw new Error(`Probing ${exportName} in ${bundle} failed:\n${result.stderr}`);
  return JSON.parse(await readFile(resultPath, 'utf-8'));
}
