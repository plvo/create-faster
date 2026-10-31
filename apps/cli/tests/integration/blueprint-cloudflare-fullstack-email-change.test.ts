import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, fileExists, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface EmailChangeNotice {
  tone: 'success' | 'error';
  message: string;
}

interface EmailChangeModule {
  EMAIL_CHANGE_CALLBACK_URL: string;
  emailChangeNotice: (search: { error?: string; emailChange?: string }, email: string) => EmailChangeNotice | null;
}

const WEB = 'apps/web';

interface HookContext {
  path: string;
  query?: Record<string, string>;
  session?: { user: { id: string } } | null;
  redirect: (url: string) => { redirectedTo: string };
}

interface Hook {
  matcher: (ctx: Pick<HookContext, 'path'>) => boolean;
  handler: (ctx: HookContext) => Promise<void>;
}

// The pieces of better-auth/api the plugin uses: the middleware is its own function, the session is the one the
// test puts on the context, and an APIError records its status.
const BETTER_AUTH_API_STUB = `export const createAuthMiddleware = (handler) => handler;
export const getSessionFromCtx = async (ctx) => ctx.session ?? null;
export class APIError extends Error {
  constructor(status, body) {
    super(body.message);
    this.status = status;
  }
}`;

describe('cloudflare-fullstack-nextjs email change', () => {
  let tempDir: string;
  let projectPath: string;
  let emailChange: EmailChangeModule;
  let hook: Hook;

  beforeAll(async () => {
    tempDir = await createTempDir();
    const result = await runCli(
      ['ec', '--blueprint', 'cloudflare-fullstack-nextjs', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode).toBe(0);
    projectPath = join(tempDir, 'ec');
    emailChange = await evaluateGeneratedModule<EmailChangeModule>(
      await readTextFile(join(projectPath, WEB, 'src/lib/auth/email-change.ts')),
      join(tempDir, 'email-change.mjs'),
    );

    const stubs = join(tempDir, 'stubs');
    await mkdir(stubs, { recursive: true });
    await Bun.write(join(stubs, 'better-auth-api.mjs'), BETTER_AUTH_API_STUB);
    const { requireSessionForEmailLink } = await evaluateGeneratedModule<{
      requireSessionForEmailLink: { hooks: { before: Hook[] } };
    }>(
      await readTextFile(join(projectPath, 'packages/auth/src/require-session-for-email-link.ts')),
      join(stubs, 'require-session-for-email-link.mjs'),
      { 'better-auth/api': './better-auth-api.mjs' },
    );
    hook = requireSessionForEmailLink.hooks.before[0] as Hook;
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('the notice the account page shows for the link the user opened', () => {
    test('a confirmed change names the new address', () => {
      expect(emailChange.emailChangeNotice({ emailChange: 'confirmed' }, 'new@example.com')).toEqual({
        tone: 'success',
        message: 'Your email address is now new@example.com.',
      });
    });

    test('an expired link says so and an unknown error code is an invalid link', () => {
      const expired = emailChange.emailChangeNotice({ error: 'TOKEN_EXPIRED' }, 'a@example.com');
      expect(expired?.tone).toBe('error');
      expect(expired?.message).toContain('expired');

      const invalid = emailChange.emailChangeNotice({ error: 'INVALID_TOKEN' }, 'a@example.com');
      expect(invalid?.tone).toBe('error');
      expect(invalid?.message).toContain('invalid');
      expect(emailChange.emailChangeNotice({ error: 'SOMETHING_ELSE' }, 'a@example.com')).toEqual(invalid);
    });

    test('a link opened by another account names the account, not the token', () => {
      expect(emailChange.emailChangeNotice({ error: 'INVALID_USER' }, 'a@example.com')?.message).toContain(
        'another account',
      );
    });

    test('an error wins over the confirmed marker the callback URL carries, and a plain visit shows nothing', () => {
      const failed = emailChange.emailChangeNotice({ emailChange: 'confirmed', error: 'TOKEN_EXPIRED' }, 'a@example.com');
      expect(failed?.tone).toBe('error');
      expect(emailChange.emailChangeNotice({}, 'a@example.com')).toBeNull();
      expect(emailChange.emailChangeNotice({ emailChange: 'other' }, 'a@example.com')).toBeNull();
    });
  });

  test('better-auth redirects the opened link to the account page, which renders the notice', async () => {
    const callback = new URL(emailChange.EMAIL_CHANGE_CALLBACK_URL, 'http://localhost');
    expect(callback.pathname).toBe('/profile/account');
    expect(await fileExists(join(projectPath, WEB, 'src/app/(dashboard)/profile/account/page.tsx'))).toBe(true);

    const page = await readTextFile(join(projectPath, WEB, 'src/app/(dashboard)/profile/account/page.tsx'));
    expect(page).toContain('emailChangeNotice(await searchParams, session.user.email)');

    const form = await readTextFile(join(projectPath, WEB, 'src/components/profile/change-email-form.tsx'));
    expect(form).toContain('callbackURL: EMAIL_CHANGE_CALLBACK_URL');
  });

  describe('the link only works in a browser signed in to the account', () => {
    const redirect = (url: string) => ({ redirectedTo: url });
    const callbackURL = '/profile/account?emailChange=confirmed';

    test('the hook watches the verification route alone', () => {
      expect(hook.matcher({ path: '/verify-email' })).toBe(true);
      expect(hook.matcher({ path: '/sign-in/email' })).toBe(false);
    });

    test('without a session the link goes back to the callback with an error, and the endpoint never runs', async () => {
      const outcome = await hook
        .handler({ path: '/verify-email', query: { callbackURL }, session: null, redirect })
        .catch((error: unknown) => error);
      expect(outcome).toEqual({ redirectedTo: `${callbackURL}&error=SIGN_IN_REQUIRED` });
    });

    test('a callback that is not a path of this site is never redirected to', async () => {
      for (const target of ['https://other.example/', '//other.example', '/\\other.example', '', 'javascript:alert(1)']) {
        const outcome = await hook
          .handler({ path: '/verify-email', query: { callbackURL: target }, session: null, redirect })
          .catch((error: unknown) => error);
        expect(outcome, target).toBeInstanceOf(Error);
        expect((outcome as Error & { status: string }).status, target).toBe('UNAUTHORIZED');
      }
    });

    test('with a session the endpoint decides', async () => {
      await expect(
        hook.handler({ path: '/verify-email', query: { callbackURL }, session: { user: { id: 'u1' } }, redirect }),
      ).resolves.toBeUndefined();
    });
  });

  test('the auth package enables the change through a link to the new address only', async () => {
    const auth = await readTextFile(join(projectPath, 'packages/auth/src/auth.ts'));
    expect(auth).toContain('changeEmail: { enabled: true }');
    expect(auth).not.toContain('updateEmailWithoutVerification');
    expect(auth).not.toContain('sendChangeEmailConfirmation');
    expect(auth).not.toContain('sendOnSignUp');
    expect(auth).toContain("deliverLink({ kind: 'change-email', to: user.email, link: url })");
    expect(auth).toContain('requireSessionForEmailLink,');
  });

  test('the agent docs describe the flow and where to plug a mail provider', async () => {
    const docs = await readTextFile(join(projectPath, 'docs/agents/auth-rbac.md'));
    expect(docs).toContain('## Email change');
    expect(docs).toContain('deliverLink');
    expect(docs).toContain('packages/auth/src/email.ts');
    expect(docs).toContain('[change-email]');
    expect(docs).toContain('updateEmailWithoutVerification');
  });
});
