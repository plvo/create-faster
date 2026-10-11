import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { getFreePort, runCommand } from './helpers';

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

const LAMBDA_EMULATOR_READY_TIMEOUT = 30_000;

/** The official AWS Lambda base image of a Node.js runtime identifier such as `nodejs22.x`. */
export function lambdaImage(runtime: string): string {
  const version = runtime.match(/^nodejs(\d+)\.x$/)?.[1];
  if (!version) throw new Error(`No Lambda Node.js image for runtime "${runtime}"`);
  return `public.ecr.aws/lambda/nodejs:${version}`;
}

async function waitForEmulator(url: string): Promise<void> {
  const deadline = Date.now() + LAMBDA_EMULATOR_READY_TIMEOUT;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return;
    } catch {
      await Bun.sleep(200);
    }
  }
  throw new Error(`The Lambda runtime interface emulator never answered on ${url}`);
}

/**
 * Runs `codeDir` as a function's code (what Lambda unzips into /var/task) in the official image of `runtime`,
 * invokes `handler` once with `event` and returns the reply: the handler's result, or the runtime's error
 * (`errorType`, `errorMessage`) when the code does not load or throws. Needs a Docker daemon.
 */
export async function invokeInLambdaRuntime(
  codeDir: string,
  handler: string,
  runtime: string,
  event: unknown,
): Promise<unknown> {
  const port = await getFreePort();
  const container = `create-faster-e2e-lambda-${process.pid}-${port}`;
  await $`docker run -d --rm --name ${container} -p 127.0.0.1:${port}:8080 -v ${codeDir}:/var/task:ro ${lambdaImage(runtime)} ${handler}`.quiet();

  try {
    const url = `http://127.0.0.1:${port}`;
    await waitForEmulator(url);
    const reply = await fetch(`${url}/2015-03-31/functions/function/invocations`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
    return reply.json();
  } finally {
    await $`docker rm -f ${container}`.quiet().nothrow();
  }
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
