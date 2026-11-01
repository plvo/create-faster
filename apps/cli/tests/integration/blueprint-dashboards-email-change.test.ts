import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REACT_HOOKS_STUB,
  type RenderedChild,
  cleanupTempDir,
  createTempDir,
  elementsOf,
  evaluateGeneratedModule,
  exportedNames,
  readTextFile,
  renderElementTree,
  runCli,
  textOf,
} from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface EmailChangeNotice {
  tone: 'success' | 'error';
  message: string;
}

interface EmailChangeModule {
  EMAIL_CHANGE_CALLBACK_URL: string;
  emailChangeNotice: (
    search: { error?: string | string[]; emailChange?: string | string[] },
    email: string,
  ) => EmailChangeNotice | null;
}

type Component = (props: Record<string, unknown>) => unknown;
type SubmitHandler = (event: { preventDefault: () => void }) => void;

interface FormHarness {
  values: Record<string, string>;
  errors: Record<string, string[]>;
  pending: Promise<void>;
  reset: () => void;
}
interface AuthClientHarness {
  requests: Record<string, unknown>[];
  answer: { error?: { message?: string } };
}
interface ToastHarness {
  errors: string[];
}

const WEB = 'apps/web';
const ACCOUNT_PATH = '/profile/account';
const CURRENT_EMAIL = 'owner@example.com';
const NEW_EMAIL = 'a-rather-long-new.address@example.com';
const PASSWORD = 'correct-horse-battery';

// A stand-in for the TanStack form kit that keeps what the component hands it: the values a test sets, the schema
// it validates with on submit, and the field components, which print the errors the schema found.
const FORM_STUB = `import { createElement } from './react.mjs';
export const harness = { values: {}, errors: {}, pending: Promise.resolve(), reset() { this.values = {}; this.errors = {}; } };
const field = (name) => {
  const print = (type) => ({ label, props }) =>
    createElement('field', { name, label, type: type ?? props?.type, error: (harness.errors[name] ?? []).join(' ') });
  return { InputField: print(), PasswordField: print('password') };
};
export function useAppForm({ defaultValues, validators, onSubmit }) {
  if (Object.keys(harness.values).length === 0) harness.values = { ...defaultValues };
  return {
    AppField: ({ name, children }) => children[0](field(name)),
    AppForm: ({ children }) => children,
    SubmitButton: ({ children }) => createElement('button', { type: 'submit' }, ...children),
    handleSubmit() {
      harness.pending = (async () => {
        harness.errors = {};
        const parsed = validators.onSubmit.safeParse(harness.values);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) (harness.errors[issue.path[0]] ??= []).push(issue.message);
          return;
        }
        await onSubmit({ value: harness.values, formApi: { reset: () => { harness.values = { ...defaultValues }; } } });
      })();
      return harness.pending;
    },
  };
}`;

const AUTH_CLIENT_STUB = `export const harness = { requests: [], answer: {} };
export const authClient = { changeEmail: async (request) => { harness.requests.push(request); return harness.answer; } };`;

const TOAST_STUB = `export const harness = { errors: [] };
export const toast = { error: (message) => harness.errors.push(message) };`;

interface Blueprint {
  name: string;
  /** The module the notice component navigates with, and what the router it hands out records for the expected URL. */
  router: { module: string; stub: string; expectedReplacement: unknown };
}

const NEXT_ROUTER_STUB = `export const harness = { replacements: [] };
export const useRouter = () => ({ replace: (...args) => harness.replacements.push(args) });`;

const START_ROUTER_STUB = `export const harness = { replacements: [] };
export const useNavigate = () => (...args) => harness.replacements.push(args);`;

const NEXT_ROUTER = {
  module: 'next/navigation',
  stub: NEXT_ROUTER_STUB,
  expectedReplacement: [ACCOUNT_PATH, { scroll: false }],
};
const START_ROUTER = {
  module: '@tanstack/react-router',
  stub: START_ROUTER_STUB,
  expectedReplacement: [{ to: ACCOUNT_PATH, search: {}, replace: true }],
};

const BLUEPRINTS: Blueprint[] = [
  { name: 'cloudflare-fullstack-nextjs', router: NEXT_ROUTER },
  { name: 'org-dashboard-nextjs', router: NEXT_ROUTER },
  { name: 'org-dashboard-tanstack-start', router: START_ROUTER },
  { name: 'multitenant-saas-nextjs', router: NEXT_ROUTER },
];

const ALERT_STUB = `import { createElement } from './react.mjs';
export const Alert = ({ variant, role, children }) => createElement('alert', { variant, role }, ...children);
export const AlertDescription = ({ children }) => createElement('alert-description', {}, ...children);`;

const ICON_STUB = `import { createElement } from './react.mjs';
export const CircleAlertIcon = () => createElement('icon', { name: 'alert' });
export const CircleCheckIcon = () => createElement('icon', { name: 'check' });`;

describe.each(BLUEPRINTS)('email change in $name', (blueprint) => {
  let tempDir: string;
  let emailChange: EmailChangeModule;
  let ChangeEmailForm: Component;
  let EmailChangeNoticeAlert: Component;
  let navigation: { replacements: unknown[][] };
  let react: { beginRender: () => void; resetState: () => void; flushEffects: () => void };
  let form: FormHarness;
  let authClient: AuthClientHarness;
  let toast: ToastHarness;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['ec', '--blueprint', blueprint.name, '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    const web = join(tempDir, 'ec', WEB);

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'react.mjs'), REACT_HOOKS_STUB);
    await Bun.write(join(stubs, 'form.mjs'), FORM_STUB);
    await Bun.write(join(stubs, 'auth-client.mjs'), AUTH_CLIENT_STUB);
    await Bun.write(join(stubs, 'sonner.mjs'), TOAST_STUB);
    await Bun.write(join(stubs, 'router.mjs'), blueprint.router.stub);
    await Bun.write(join(stubs, 'alert.mjs'), ALERT_STUB);
    await Bun.write(join(stubs, 'lucide.mjs'), ICON_STUB);
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;
    form = ((await import(join(stubs, 'form.mjs'))) as { harness: FormHarness }).harness;
    authClient = ((await import(join(stubs, 'auth-client.mjs'))) as { harness: AuthClientHarness }).harness;
    toast = ((await import(join(stubs, 'sonner.mjs'))) as { harness: ToastHarness }).harness;
    navigation = ((await import(join(stubs, 'router.mjs'))) as { harness: typeof navigation }).harness;

    emailChange = await evaluateGeneratedModule<EmailChangeModule>(
      await readTextFile(join(web, 'src/lib/auth/email-change.ts')),
      join(stubs, 'email-change.mjs'),
    );
    ({ ChangeEmailForm } = await evaluateGeneratedModule<{ ChangeEmailForm: Component }>(
      await readTextFile(join(web, 'src/components/profile/change-email-form.tsx')),
      join(stubs, 'change-email-form.mjs'),
      {
        react: join(stubs, 'react.mjs'),
        zod: Bun.resolveSync('zod', import.meta.dir),
        sonner: join(stubs, 'sonner.mjs'),
        '@repo/auth/auth-client': join(stubs, 'auth-client.mjs'),
        '@repo/ui/lib/form': join(stubs, 'form.mjs'),
        '@/lib/auth/email-change': join(stubs, 'email-change.mjs'),
      },
      'tsx',
    ));
    ({ EmailChangeNoticeAlert } = await evaluateGeneratedModule<{ EmailChangeNoticeAlert: Component }>(
      await readTextFile(join(web, 'src/components/profile/email-change-notice.tsx')),
      join(stubs, 'email-change-notice.mjs'),
      {
        react: join(stubs, 'react.mjs'),
        [blueprint.router.module]: join(stubs, 'router.mjs'),
        'lucide-react': join(stubs, 'lucide.mjs'),
        '@repo/ui/components/ui/alert': join(stubs, 'alert.mjs'),
        '@/lib/auth/email-change': join(stubs, 'email-change.mjs'),
      },
      'tsx',
    ));
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  // The blueprint renders its own `src/lib/server.ts` to hand better-auth the Worker's waitUntil. Every page guard and
  // the tRPC context import from it, so it must offer what the one of a plain D1 project offers.
  test.if(blueprint.name === 'cloudflare-fullstack-nextjs')('the blueprint server module exports what the deployment server module of a plain project exports', async () => {
    const plainDir = await createTempDir();
    try {
      const plain = await runCli(
        ['plain', '--app', 'web:nextjs:better-auth', '--database', 'd1', '--orm', 'drizzle', '--deployment', 'cloudflare', '--no-git', '--no-install', '--pm', 'bun'],
        plainDir,
      );
      expect(plain.exitCode, plain.stderr).toBe(0);
      const expected = (await exportedNames(join(plainDir, 'plain/src/lib/server.ts'))).sort();
      expect(expected).toContain('getRequestSession');
      expect((await exportedNames(join(tempDir, 'ec', WEB, 'src/lib/server.ts'))).sort()).toEqual(expected);
    } finally {
      await cleanupTempDir(plainDir);
    }
  });

  describe('the notice the account page shows for the link the user opened', () => {
    const notice = (search: Parameters<EmailChangeModule['emailChangeNotice']>[0]) =>
      emailChange.emailChangeNotice(search, CURRENT_EMAIL);

    test('a confirmed change names the address', () => {
      expect(notice({ emailChange: 'confirmed' })).toEqual({
        tone: 'success',
        message: `Your email address is now ${CURRENT_EMAIL}.`,
      });
    });

    test.each([
      ['TOKEN_EXPIRED', 'expired'],
      ['SIGN_IN_REQUIRED', 'signed out'],
      ['INVALID_USER', 'another account'],
      ['USER_NOT_FOUND', 'already been used'],
      ['EMAIL_TAKEN', 'can no longer be used'],
      ['INVALID_TOKEN', 'invalid'],
    ])('the code %s says what happened', (code, wording) => {
      const found = notice({ error: code });
      expect(found?.tone).toBe('error');
      expect(found?.message).toContain(wording);
    });

    test('a link opened signed out says nothing changed and what to do now', () => {
      expect(notice({ error: 'SIGN_IN_REQUIRED' })?.message).toBe(
        'The link was opened while you were signed out, so nothing changed. Open it again now that you are signed in.',
      );
    });

    test.each(['__proto__', 'toString', 'constructor', 'hasOwnProperty', 'NOPE'])(
      'the code %s is an invalid link, never a crash or an empty message',
      (code) => {
        const found = notice({ error: code });
        expect(found?.tone).toBe('error');
        expect(found?.message).toBe('This confirmation link is invalid. Request a new one below.');
      },
    );

    test('a value given twice reads its first', () => {
      expect(notice({ error: ['TOKEN_EXPIRED', 'EMAIL_TAKEN'] })?.message).toContain('expired');
      expect(notice({ emailChange: ['confirmed', 'other'] })?.tone).toBe('success');
    });

    test('an error wins over the confirmed marker the callback carries, and a plain visit shows nothing', () => {
      expect(notice({ emailChange: 'confirmed', error: 'TOKEN_EXPIRED' })?.tone).toBe('error');
      expect(notice({})).toBeNull();
      expect(notice({ emailChange: 'other' })).toBeNull();
    });
  });

  // A link opened signed out is sent back to the account page with `error=SIGN_IN_REQUIRED`; the sign-in has to bring
  // the user back to that URL with its query, or the sentence that says to open the link again never shows.
  test.if(blueprint.name === 'multitenant-saas-nextjs')(
    'the proxy sends a signed-out visit to sign in with the whole path and query to come back to',
    async () => {
      const stubs = join(tempDir, 'stubs');
      await Bun.write(join(stubs, 'cookies.mjs'), 'export const getSessionCookie = () => null;');
      await Bun.write(
        join(stubs, 'server.mjs'),
        'export const NextResponse = { redirect: (url) => ({ redirect: String(url) }), next: () => ({ next: true }) };',
      );
      const { default: proxy } = await evaluateGeneratedModule<{
        default: (request: unknown) => { redirect?: string; next?: boolean };
      }>(await readTextFile(join(tempDir, 'ec', WEB, 'src/proxy.ts')), join(stubs, 'proxy.mjs'), {
        'better-auth/cookies': join(stubs, 'cookies.mjs'),
        'next/server': join(stubs, 'server.mjs'),
      });

      const search = '?emailChange=confirmed&error=SIGN_IN_REQUIRED';
      const answer = proxy({ url: `http://localhost:3000${ACCOUNT_PATH}${search}`, nextUrl: { pathname: ACCOUNT_PATH, search } });
      const login = new URL(answer.redirect ?? '');
      expect([login.pathname, login.searchParams.get('redirect')]).toEqual(['/login', `${ACCOUNT_PATH}${search}`]);
    },
  );

  test('the notice and the form use the theme tokens, never a raw Tailwind palette color', async () => {
    const rawColor = /\b(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke)-(?:red|green|blue|amber|yellow|orange|emerald|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;
    for (const file of ['email-change-notice.tsx', 'change-email-form.tsx']) {
      expect(await readTextFile(join(tempDir, 'ec', WEB, 'src/components/profile', file))).not.toMatch(rawColor);
    }
  });

  describe('the alert the account page shows', () => {
    const show = async (notice: EmailChangeNotice | null): Promise<RenderedChild[]> => {
      react.beginRender();
      return renderElementTree({ type: EmailChangeNoticeAlert, props: { notice } });
    };

    beforeEach(() => {
      react.resetState();
      navigation.replacements = [];
    });

    test('a failure is a destructive alert with the message', async () => {
      const tree = await show({ tone: 'error', message: 'This confirmation link has expired.' });
      const alert = elementsOf(tree).find((element) => element.tag === 'alert');
      expect(alert?.props.variant).toBe('destructive');
      expect(textOf(alert as never)).toBe('This confirmation link has expired.');
    });

    test('a confirmation is a status alert with the message', async () => {
      const tree = await show({ tone: 'success', message: `Your email address is now ${NEW_EMAIL}.` });
      const alert = elementsOf(tree).find((element) => element.tag === 'alert');
      expect(alert?.props.role).toBe('status');
      expect(textOf(alert as never)).toBe(`Your email address is now ${NEW_EMAIL}.`);
    });

    test('the query that carried the notice is dropped from the URL once, so a reload does not say it again', async () => {
      await show({ tone: 'success', message: 'Your email address is now a@example.com.' });
      react.flushEffects();
      expect(navigation.replacements).toEqual([blueprint.router.expectedReplacement as unknown[]]);
    });

    test('a plain visit shows nothing and leaves the URL alone', async () => {
      expect(await show(null)).toEqual([]);
      react.flushEffects();
      expect(navigation.replacements).toEqual([]);
    });
  });

  describe('the change email form', () => {
    const render = async (): Promise<RenderedChild[]> => {
      react.beginRender();
      return renderElementTree({ type: ChangeEmailForm, props: { email: CURRENT_EMAIL } });
    };

    const status = (tree: RenderedChild[]) => elementsOf(tree).find((element) => element.props.role === 'status');
    const errorsOf = (tree: RenderedChild[]) =>
      Object.fromEntries(
        elementsOf(tree)
          .filter((element) => element.tag === 'field')
          .map((element) => [element.props.name, element.props.error]),
      );

    const submit = async (values: Record<string, string>): Promise<RenderedChild[]> => {
      form.values = values;
      const handler = elementsOf(await render()).find((element) => element.tag === 'form')?.props.onSubmit as
        | SubmitHandler
        | undefined;
      if (!handler) throw new Error('the form has no submit handler');
      handler({ preventDefault: () => {} });
      await form.pending;
      return render();
    };

    beforeEach(() => {
      react.resetState();
      form.reset();
      authClient.requests = [];
      authClient.answer = { data: { status: true } } as AuthClientHarness['answer'];
      toast.errors = [];
    });

    test('the status element is there before anything is sent, and empty', async () => {
      const tree = await render();
      expect(status(tree)).toBeDefined();
      expect(textOf(status(tree) as never)).toBe('');
    });

    test('an address that is not valid is refused in the form, and nothing is sent', async () => {
      const tree = await submit({ newEmail: 'not-an-email', currentPassword: PASSWORD });
      expect(errorsOf(tree).newEmail).toBe('Enter a valid email address');
      expect(authClient.requests).toEqual([]);
    });

    test('the current address, in any case, is refused in the form', async () => {
      const tree = await submit({ newEmail: ` ${CURRENT_EMAIL.toUpperCase()} `, currentPassword: PASSWORD });
      expect(errorsOf(tree).newEmail).toBe('This is already your email address');
      expect(authClient.requests).toEqual([]);
    });

    test('a missing password is refused in the form', async () => {
      const tree = await submit({ newEmail: NEW_EMAIL, currentPassword: '' });
      expect(errorsOf(tree).currentPassword).toBe('Enter your current password');
      expect(authClient.requests).toEqual([]);
    });

    test('a request sends the address, the password and the account page as the callback, then says the same neutral thing', async () => {
      const tree = await submit({ newEmail: ` ${NEW_EMAIL} `, currentPassword: PASSWORD });
      expect(authClient.requests).toEqual([
        { newEmail: NEW_EMAIL, currentPassword: PASSWORD, callbackURL: emailChange.EMAIL_CHANGE_CALLBACK_URL },
      ]);
      expect(textOf(status(tree) as never)).toBe(
        `If ${NEW_EMAIL} can be used, a confirmation link has been sent to it. Your email does not change until you open the link.`,
      );
      expect(form.values).toEqual({ newEmail: '', currentPassword: '' });
      expect(toast.errors).toEqual([]);
    });

    test('a refusal of the server is a toast with its message, and keeps the form as it was', async () => {
      authClient.answer = { error: { message: 'Invalid password' } };
      const tree = await submit({ newEmail: NEW_EMAIL, currentPassword: 'wrong' });
      expect(toast.errors).toEqual(['Invalid password']);
      expect(textOf(status(tree) as never)).toBe('');
      expect(form.values).toEqual({ newEmail: NEW_EMAIL, currentPassword: 'wrong' });
    });

    test('a refusal without a message still says that the change failed', async () => {
      authClient.answer = { error: {} };
      await submit({ newEmail: NEW_EMAIL, currentPassword: PASSWORD });
      expect(toast.errors).toEqual(['Email change failed']);
    });

    test('a new request clears the message of the previous one while it runs', async () => {
      await submit({ newEmail: NEW_EMAIL, currentPassword: PASSWORD });
      authClient.answer = { error: { message: 'Invalid password' } };
      const tree = await submit({ newEmail: 'second@example.com', currentPassword: 'wrong' });
      expect(textOf(status(tree) as never)).toBe('');
    });
  });
});
