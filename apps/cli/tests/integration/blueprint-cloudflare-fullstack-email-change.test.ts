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

describe('cloudflare-fullstack-nextjs email change', () => {
  let tempDir: string;
  let emailChange: EmailChangeModule;
  let ChangeEmailForm: Component;
  let react: { beginRender: () => void; resetState: () => void };
  let form: FormHarness;
  let authClient: AuthClientHarness;
  let toast: ToastHarness;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['ec', '--blueprint', 'cloudflare-fullstack-nextjs', '--no-git', '--no-install', '--pm', 'bun'],
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
    react = (await import(join(stubs, 'react.mjs'))) as typeof react;
    form = ((await import(join(stubs, 'form.mjs'))) as { harness: FormHarness }).harness;
    authClient = ((await import(join(stubs, 'auth-client.mjs'))) as { harness: AuthClientHarness }).harness;
    toast = ((await import(join(stubs, 'sonner.mjs'))) as { harness: ToastHarness }).harness;

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
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
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
