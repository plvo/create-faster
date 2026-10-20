import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REACT_HOOKS_STUB,
  type RenderedChild,
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  readTextFile,
  renderElementTree,
  runCli,
  textOf,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = ['cloudflare-static-site-nextjs', 'showcase-nextjs'];
const ENDPOINT_VARIABLE = 'NEXT_PUBLIC_CONTACT_FORM_URL';
const ENDPOINT = 'https://forms.example.test/f/abc123';

type Component = (props: Record<string, unknown>) => unknown;
type SubmitHandler = (event: { preventDefault: () => void; currentTarget: unknown }) => Promise<void>;

interface ContactModule {
  sendContactMessage: (endpoint: string | undefined, message: FormData) => Promise<string>;
}

interface Request {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

const BUTTON_STUB = `import { createElement } from './react.mjs';
export const Button = ({ children, ...props }) => createElement('button', props, ...children);`;

describe.each(BLUEPRINTS)('%s contact form', (blueprint) => {
  let tempDir: string;
  let projectPath: string;
  let stubs: string;
  let react: { beginRender: () => void; resetState: () => void };
  let loads = 0;
  const realFetch = globalThis.fetch;
  const realFormData = globalThis.FormData;
  let requests: Request[];

  const stubFetch = (respond: () => Promise<Response>) => {
    requests = [];
    globalThis.fetch = (async (url: string, init: Request['init']) => {
      requests.push({ url, init });
      return respond();
    }) as unknown as typeof fetch;
  };

  // The endpoint is read from the environment when the module loads, as the build inlines it.
  const loadContactModule = async (endpoint: string | undefined): Promise<{ file: string; module: ContactModule }> => {
    const file = join(stubs, `contact-${loads++}.mjs`);
    const previous = process.env[ENDPOINT_VARIABLE];
    if (endpoint === undefined) delete process.env[ENDPOINT_VARIABLE];
    else process.env[ENDPOINT_VARIABLE] = endpoint;
    try {
      const source = await readTextFile(join(projectPath, 'src/lib/contact.ts'));
      return { file, module: await evaluateGeneratedModule<ContactModule>(source, file) };
    } finally {
      if (previous === undefined) delete process.env[ENDPOINT_VARIABLE];
      else process.env[ENDPOINT_VARIABLE] = previous;
    }
  };

  const loadForm = async (endpoint: string | undefined): Promise<Component> => {
    const { file } = await loadContactModule(endpoint);
    const source = await readTextFile(join(projectPath, 'src/components/contact/contact-form.tsx'));
    const module = await evaluateGeneratedModule<{ ContactForm: Component }>(
      source,
      join(stubs, `contact-form-${loads++}.mjs`),
      { react: join(stubs, 'react.mjs'), '@/components/ui/button': join(stubs, 'button.mjs'), '@/lib/contact': file },
      'tsx',
    );
    react.resetState();
    return module.ContactForm;
  };

  const render = async (form: Component): Promise<RenderedChild[]> => {
    react.beginRender();
    return renderElementTree({ type: form, props: {} });
  };

  const submitButton = (tree: RenderedChild[]) => {
    const button = elementsOf(tree).find((element) => element.tag === 'button' && element.props.type === 'submit');
    if (!button) throw new Error('the form has no submit button');
    return button;
  };

  const pageText = (tree: RenderedChild[]): string => tree.map(textOf).join(' ');

  const submit = async (tree: RenderedChild[], form: { reset: () => void }) => {
    const handler = elementsOf(tree).find((element) => element.tag === 'form')?.props.onSubmit as
      | SubmitHandler
      | undefined;
    if (!handler) throw new Error('the form has no submit handler');
    let prevented = false;
    const done = handler({ preventDefault: () => (prevented = true), currentTarget: form });
    return { done, wasPrevented: () => prevented };
  };

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(['contact', '--blueprint', blueprint, '--no-git', '--no-install'], tempDir);
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'contact');
    stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'react.mjs'), REACT_HOOKS_STUB);
    await Bun.write(join(stubs, 'button.mjs'), BUTTON_STUB);
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;
    globalThis.FormData = class {
      constructor(readonly source: unknown) {}
    } as unknown as typeof FormData;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    globalThis.FormData = realFormData;
    await cleanupTempDir(tempDir);
  });

  describe('sendContactMessage', () => {
    const message = () => {
      const data = new realFormData();
      data.set('name', 'Ada');
      return data;
    };

    test('without an endpoint nothing is sent', async () => {
      stubFetch(async () => new Response('{}'));
      const { module } = await loadContactModule(undefined);
      expect(await module.sendContactMessage(undefined, message())).toBe('unconfigured');
      expect(await module.sendContactMessage('', message())).toBe('unconfigured');
      expect(requests).toEqual([]);
    });

    test('with an endpoint the message is posted as form data and asks for a JSON answer', async () => {
      stubFetch(async () => new Response('{}', { status: 200 }));
      const { module } = await loadContactModule(ENDPOINT);
      const data = message();
      expect(await module.sendContactMessage(ENDPOINT, data)).toBe('sent');
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(ENDPOINT);
      expect(requests[0]?.init.method).toBe('POST');
      expect(requests[0]?.init.headers.Accept).toBe('application/json');
      expect(requests[0]?.init.body).toBe(data);
    });

    test('a refusal or a network error is reported as a failure, never thrown', async () => {
      const { module } = await loadContactModule(ENDPOINT);
      stubFetch(async () => new Response('{}', { status: 422 }));
      expect(await module.sendContactMessage(ENDPOINT, message())).toBe('failed');
      stubFetch(async () => {
        throw new TypeError('network down');
      });
      expect(await module.sendContactMessage(ENDPOINT, message())).toBe('failed');
    });
  });

  describe('ContactForm', () => {
    test('without an endpoint the button is disabled and the form says it is not connected', async () => {
      stubFetch(async () => new Response('{}'));
      const form = await loadForm(undefined);
      const tree = await render(form);

      expect(submitButton(tree).props.disabled).toBe(true);
      expect(pageText(tree)).toContain('not connected');

      let resets = 0;
      const { done, wasPrevented } = await submit(tree, { reset: () => resets++ });
      await done;
      expect(wasPrevented(), 'the browser never posts the form itself').toBe(true);
      expect(requests).toEqual([]);
      expect(resets).toBe(0);
    });

    test('with an endpoint the button is enabled and nothing warns before the submit', async () => {
      const tree = await render(await loadForm(ENDPOINT));

      expect(submitButton(tree).props.disabled).toBeFalsy();
      expect(pageText(tree)).not.toContain('not connected');
    });

    test('a submit posts the form, shows a success and clears the form', async () => {
      stubFetch(async () => new Response('{}', { status: 200 }));
      const form = await loadForm(ENDPOINT);
      let resets = 0;
      const formElement = { reset: () => resets++ };

      const { done, wasPrevented } = await submit(await render(form), formElement);
      await done;
      const tree = await render(form);

      expect(wasPrevented(), 'the browser never posts the form itself').toBe(true);
      expect(requests).toHaveLength(1);
      expect((requests[0]?.init.body as unknown as { source: unknown }).source).toBe(formElement);
      expect(pageText(tree)).toContain('your message was sent');
      expect(resets).toBe(1);
      expect(submitButton(tree).props.disabled).toBeFalsy();
    });

    test('the button is disabled and says Sending while the request is pending', async () => {
      let answer: (response: Response) => void = () => {};
      stubFetch(() => new Promise((resolve) => (answer = resolve)));
      const form = await loadForm(ENDPOINT);

      const { done } = await submit(await render(form), { reset: () => {} });
      const pending = await render(form);
      expect(submitButton(pending).props.disabled).toBe(true);
      expect(pageText(pending)).toContain('Sending');

      answer(new Response('{}'));
      await done;
    });

    test('a failure shows an alert and keeps what was typed', async () => {
      stubFetch(async () => new Response('{}', { status: 500 }));
      const form = await loadForm(ENDPOINT);
      let resets = 0;

      const { done } = await submit(await render(form), { reset: () => resets++ });
      await done;
      const tree = await render(form);

      const alert = elementsOf(tree).find((element) => element.props.role === 'alert');
      expect(alert && textOf(alert)).toContain('could not be sent');
      expect(pageText(tree)).not.toContain('your message was sent');
      expect(resets).toBe(0);
      expect(submitButton(tree).props.disabled).toBeFalsy();
    });
  });

  test('the endpoint is a blank third-party variable that the README and the env file explain', async () => {
    const env = await readTextFile(join(projectPath, '.env.example'));
    expect(env).toMatch(new RegExp(`^${ENDPOINT_VARIABLE}=[ \\t]+#`, 'm'));
    const readme = await readTextFile(join(projectPath, 'README.md'));
    expect(readme).toContain(`\`${ENDPOINT_VARIABLE}\``);
    expect(readme).toContain('contact form');
  });
});
