import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  expectIngestProxiesToPostHog,
  expectServesPageWithClientScript,
  runCli,
  type RunningServer,
  runCommand,
  type ServerOutput,
  startServer,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 180_000;
const TIMEOUT_START = 60_000;
const MAX_INGEST_BODY_BYTES = 64 * 1024 * 1024;

describe('tanstack-start-loaded', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        'tanstack-start-loaded',
        '--app',
        'tanstack-start-loaded:tanstack-start:shadcn,next-themes,react-hook-form,tanstack-query,tanstack-devtools,evlog',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'tanstack-start-loaded');
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'start serves the built app and its client assets, with evlog logging each request',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      let output: ServerOutput;
      try {
        await expectServesPageWithClientScript(server.url);
      } finally {
        output = await server.stop();
      }
      expect(output.stdout).toContain('"service":"tanstack-start-loaded"');
    },
    TIMEOUT_START,
  );

  test(
    'start server-renders the next-themes script as the first node of the body',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      try {
        const html = await (await fetch(server.url)).text();
        expect(html).toContain('<html lang="en"');
        expect(html).toMatch(/<body><script[^>]*>[^<]*"tanstack-start-loaded-theme"/);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_START,
  );

  test(
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );
});

describe('tanstack-start-mdx', () => {
  let projectDir: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      ['tanstack-start-mdx', '--app', 'tanstack-start-mdx:tanstack-start:mdx', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'tanstack-start-mdx');
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'start serves /mdx and a document page with their rendered content, and 404s an unknown document',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      try {
        const home = await fetch(`${server.url}/mdx`);
        expect(home.status).toBe(200);
        const homeHtml = await home.text();
        expect(homeHtml).toContain('<title>Home</title>');
        expect(homeHtml).toContain('<h1 class="h1-mdx">Home</h1>');
        expect(homeHtml).toContain('href="/mdx/cool"');

        const cool = await fetch(`${server.url}/mdx/cool`);
        expect(cool.status).toBe(200);
        const coolHtml = await cool.text();
        expect(coolHtml).toContain('<title>Cool</title>');
        expect(coolHtml).toContain('<h1 class="h1-mdx">Cool</h1>');
        expect(coolHtml).toContain('<blockquote class="blockquote-mdx">');

        const missing = await fetch(`${server.url}/mdx/does-not-exist`);
        expect(missing.status).toBe(404);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_START,
  );
});

interface RecordedRequest {
  method: string;
  path: string;
  headers: Headers;
  chunks: Uint8Array[];
}

// Redirects the server's outbound PostHog calls to a local upstream, to observe what reaches PostHog.
const REDIRECT_POSTHOG_PRELOAD = `
const upstream = process.env.POSTHOG_TEST_UPSTREAM;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!url.hostname.endsWith('posthog.com')) return realFetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('x-test-upstream-host', url.hostname);
  return realFetch(upstream + url.pathname + url.search, { ...init, headers });
};
`;

const UPSTREAM_RESPONSE_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': 'https://us.posthog.com',
  'set-cookie': 'ph_session=1; Domain=posthog.com',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'alt-svc': 'h3=":443"',
};

function startUpstream(): { url: string; requests: RecordedRequest[]; stop: () => void } {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const recorded: RecordedRequest = {
        method: request.method,
        path: url.pathname + url.search,
        headers: request.headers,
        chunks: [],
      };
      requests.push(recorded);
      if (request.body) for await (const chunk of request.body) recorded.chunks.push(chunk);
      return new Response('{"status":"Ok"}', { headers: UPSTREAM_RESPONSE_HEADERS });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => void server.stop(true) };
}

function bodyText(request: RecordedRequest): string {
  return request.chunks.map((chunk) => new TextDecoder().decode(chunk, { stream: true })).join('');
}

async function waitFor(condition: () => boolean, timeout = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await Bun.sleep(50);
  }
  return condition();
}

describe('tanstack-start-posthog', () => {
  let projectDir: string;
  let preloadPath: string;
  let installResult: CommandResult;

  beforeAll(async () => {
    const tempDir = await createTempDir();
    const result = await runCli(
      [
        'tanstack-start-posthog',
        '--app',
        'tanstack-start-posthog:tanstack-start:posthog,next-themes,evlog',
        '--no-git',
        '--no-install',
        '--pm',
        'bun',
      ],
      tempDir,
    );
    expect(result.exitCode).toBe(0);

    projectDir = join(tempDir, 'tanstack-start-posthog');
    preloadPath = join(tempDir, 'redirect-posthog.mjs');
    await writeFile(preloadPath, REDIRECT_POSTHOG_PRELOAD);
    installResult = await runCommand(['bun', 'install'], projectDir);
  }, TIMEOUT_INSTALL + 30_000);

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test(
    'installs dependencies',
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    TIMEOUT_INSTALL,
  );

  test(
    'builds',
    async () => {
      const result = await runCommand(['bun', 'run', 'build'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_BUILD,
  );

  test(
    'type-checks',
    async () => {
      const result = await runCommand(['bunx', 'tsc', '--noEmit'], projectDir);
      expect(result.exitCode).toBe(0);
    },
    TIMEOUT_TYPECHECK,
  );

  test(
    'start serves the page and proxies /ingest to PostHog like a direct call',
    async () => {
      const server = await startServer(['bun', 'run', 'start'], projectDir);
      try {
        await expectServesPageWithClientScript(server.url);
        await expectIngestProxiesToPostHog(server.url);
      } finally {
        await server.stop();
      }
    },
    TIMEOUT_START,
  );

  describe('against a local upstream', () => {
    let upstream: ReturnType<typeof startUpstream>;
    let server: RunningServer;

    beforeAll(async () => {
      upstream = startUpstream();
      server = await startServer(['bun', 'run', 'start'], projectDir, {
        env: { NODE_OPTIONS: `--import ${preloadPath}`, POSTHOG_TEST_UPSTREAM: upstream.url },
      });
    }, TIMEOUT_START);

    afterAll(async () => {
      await server?.stop();
      upstream?.stop();
    });

    test(
      'forwards only the allowlisted request headers and the real client address',
      async () => {
        const before = upstream.requests.length;
        const response = await fetch(`${server.url}/ingest/e/?ip=1`, {
          method: 'POST',
          headers: {
            'content-type': 'text/plain',
            'user-agent': 'e2e-agent',
            origin: 'https://app.example.com',
            referer: 'https://app.example.com/page',
            accept: '*/*',
            'accept-language': 'fr',
            cookie: 'session=secret',
            authorization: 'Bearer secret',
            'proxy-authorization': 'Basic secret',
            'cf-access-jwt-assertion': 'jwt',
            'x-amzn-oidc-data': 'oidc',
            'x-real-ip': '6.6.6.6',
            'cf-connecting-ip': '6.6.6.6',
          },
          body: 'payload',
        });
        expect(response.status).toBe(200);

        const forwarded = upstream.requests[before];
        expect(forwarded.method).toBe('POST');
        expect(forwarded.path).toBe('/e/?ip=1');
        expect(forwarded.headers.get('x-test-upstream-host')).toBe('us.i.posthog.com');
        expect(bodyText(forwarded)).toBe('payload');

        expect(forwarded.headers.get('content-type')).toBe('text/plain');
        expect(forwarded.headers.get('user-agent')).toBe('e2e-agent');
        expect(forwarded.headers.get('origin')).toBe('https://app.example.com');
        expect(forwarded.headers.get('referer')).toBe('https://app.example.com/page');
        expect(forwarded.headers.get('accept-language')).toBe('fr');

        const withheld = [
          'cookie',
          'authorization',
          'proxy-authorization',
          'cf-access-jwt-assertion',
          'x-amzn-oidc-data',
          'x-real-ip',
          'cf-connecting-ip',
        ];
        for (const name of withheld) expect(forwarded.headers.get(name)).toBeNull();
        expect(forwarded.headers.get('x-forwarded-for')).toMatch(/(^|:)127\.0\.0\.1$/);
      },
      TIMEOUT_START,
    );

    test(
      'routes /static and /array to the assets host',
      async () => {
        const before = upstream.requests.length;
        await fetch(`${server.url}/ingest/static/array.js`);
        await fetch(`${server.url}/ingest/array/phc_token/config.js`);
        const hosts = upstream.requests.slice(before).map((request) => request.headers.get('x-test-upstream-host'));
        expect(hosts).toEqual(['us-assets.i.posthog.com', 'us-assets.i.posthog.com']);
      },
      TIMEOUT_START,
    );

    test(
      'keeps the upstream cookie, HSTS and alt-svc headers away from the browser, and keeps CORS',
      async () => {
        const response = await fetch(`${server.url}/ingest/flags/?v=2`, { method: 'POST', body: '{}' });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/json');
        expect(response.headers.get('access-control-allow-origin')).toBe('https://us.posthog.com');
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(response.headers.get('strict-transport-security')).toBeNull();
        expect(response.headers.get('alt-svc')).toBeNull();
      },
      TIMEOUT_START,
    );

    test(
      'streams the request body to PostHog instead of buffering it',
      async () => {
        const before = upstream.requests.length;
        let finish!: () => void;
        const clientMayFinish = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('first-chunk;'));
            await clientMayFinish;
            controller.enqueue(encoder.encode('second-chunk'));
            controller.close();
          },
        });

        const pending = fetch(`${server.url}/ingest/e/`, { method: 'POST', body, duplex: 'half' } as RequestInit);
        const reachedUpstream = await waitFor(() => (upstream.requests[before]?.chunks.length ?? 0) > 0);
        finish();
        const response = await pending;

        expect(reachedUpstream).toBe(true);
        expect(response.status).toBe(200);
        expect(bodyText(upstream.requests[before])).toBe('first-chunk;second-chunk');
      },
      TIMEOUT_START,
    );

    test(
      'rejects a declared body over the cap without reaching PostHog',
      async () => {
        const before = upstream.requests.length;
        const response = await fetch(`${server.url}/ingest/e/`, {
          method: 'POST',
          body: new Uint8Array(MAX_INGEST_BODY_BYTES + 1),
        });
        expect(response.status).toBe(413);
        expect(upstream.requests.length).toBe(before);
      },
      TIMEOUT_START,
    );

    test(
      'rejects a chunked body that grows over the cap',
      async () => {
        const chunk = new Uint8Array(1024 * 1024);
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent > MAX_INGEST_BODY_BYTES / chunk.byteLength + 1) return controller.close();
            controller.enqueue(chunk);
            sent++;
          },
        });
        const response = await fetch(`${server.url}/ingest/e/`, { method: 'POST', body, duplex: 'half' } as RequestInit);
        expect(response.status).toBe(413);
      },
      TIMEOUT_START,
    );
  });
});
