import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = ['cloudflare-static-site-nextjs', 'showcase-nextjs'];
const ENDPOINT_VARIABLE = 'NEXT_PUBLIC_CONTACT_FORM_URL';
const ENDPOINT = 'https://forms.example.test/f/abc123';

interface ContactModule {
  sendContactMessage: (endpoint: string | undefined, message: FormData) => Promise<string>;
}

describe.each(BLUEPRINTS)('%s contact form', (blueprint) => {
  let tempDir: string;
  let projectPath: string;
  let contact: ContactModule;
  const realFetch = globalThis.fetch;
  let requests: { url: string; init: RequestInit }[];

  const message = () => {
    const data = new FormData();
    data.set('name', 'Ada');
    data.set('email', 'ada@example.test');
    data.set('message', 'Hello');
    return data;
  };

  const stubFetch = (respond: () => Promise<Response>) => {
    requests = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return respond();
    }) as unknown as typeof fetch;
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['contact', '--blueprint', blueprint, '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'contact');
    contact = await evaluateGeneratedModule<ContactModule>(
      await readTextFile(join(projectPath, 'src/lib/contact.ts')),
      join(tempDir, 'contact-module.mjs'),
    );
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await cleanupTempDir(tempDir);
  });

  test('the form does not post to the page that serves it: no form action, no method', async () => {
    const page = await readTextFile(join(projectPath, 'src/app/contact/page.tsx'));
    const form = await readTextFile(join(projectPath, 'src/components/contact/contact-form.tsx'));
    for (const source of [page, form]) {
      expect(source).not.toContain('action="#"');
      expect(source).not.toContain('method="POST"');
    }
    expect(form).toContain('event.preventDefault()');
  });

  test('without an endpoint nothing is sent', async () => {
    stubFetch(async () => new Response('{}'));
    expect(await contact.sendContactMessage(undefined, message())).toBe('unconfigured');
    expect(await contact.sendContactMessage('', message())).toBe('unconfigured');
    expect(requests).toEqual([]);
  });

  test('with an endpoint the message is posted as form data and a success is reported', async () => {
    stubFetch(async () => new Response('{}', { status: 200 }));
    const data = message();
    expect(await contact.sendContactMessage(ENDPOINT, data)).toBe('sent');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(ENDPOINT);
    expect(requests[0]?.init.method).toBe('POST');
    expect(requests[0]?.init.body).toBe(data);
  });

  test('a refusal or a network error is reported as a failure, never thrown', async () => {
    stubFetch(async () => new Response('{}', { status: 422 }));
    expect(await contact.sendContactMessage(ENDPOINT, message())).toBe('failed');
    stubFetch(async () => {
      throw new TypeError('network down');
    });
    expect(await contact.sendContactMessage(ENDPOINT, message())).toBe('failed');
  });

  test('the endpoint is a blank third-party variable that the README and the env file explain', async () => {
    const env = await readTextFile(join(projectPath, '.env.example'));
    expect(env).toMatch(new RegExp(`^${ENDPOINT_VARIABLE}=\\s+#`, 'm'));
    const readme = await readTextFile(join(projectPath, 'README.md'));
    expect(readme).toContain(`\`${ENDPOINT_VARIABLE}\``);
    expect(readme).toContain('contact form');
  });
});
