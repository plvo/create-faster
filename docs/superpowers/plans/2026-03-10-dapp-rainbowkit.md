# dapp-rainbowkit Blueprint Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `dapp-rainbowkit` blueprint — open-source Web3 dApp using RainbowKit + better-auth SIWE for wallet authentication.

**Architecture:** Blueprint composes existing libraries (shadcn, next-themes, better-auth, tanstack-query, trpc) with drizzle+postgres. Overrides auth config to add SIWE plugin, adds RainbowKit providers and wallet UI. Two routes: public landing (`/`) and authenticated dashboard (`/protected`). Better-auth manages users/sessions natively — no custom schema needed.

**Tech Stack:** Next.js, RainbowKit, wagmi, viem, better-auth (SIWE plugin), tRPC, shadcn, Drizzle, PostgreSQL

**Spec:** `docs/superpowers/specs/2026-03-10-dapp-rainbowkit-blueprint-design.md`

---

## File Map

### New files (blueprint templates)

| File | Purpose |
|------|---------|
| `templates/blueprints/dapp-rainbowkit/src/lib/auth/auth.ts.hbs` | Override better-auth config: add SIWE plugin with viem verification |
| `templates/blueprints/dapp-rainbowkit/src/lib/auth/auth-client.ts.hbs` | Override better-auth client: add siweClient() plugin |
| `templates/blueprints/dapp-rainbowkit/src/lib/wagmi.ts.hbs` | Standard wagmi config via RainbowKit's getDefaultConfig |
| `templates/blueprints/dapp-rainbowkit/src/components/app-providers.tsx.hbs` | Override: WagmiProvider + RainbowKit + SIWE adapter + auth status |
| `templates/blueprints/dapp-rainbowkit/src/components/header.tsx.hbs` | Override: RainbowKit standard ConnectButton |
| `templates/blueprints/dapp-rainbowkit/src/app/layout.tsx.hbs` | Override: root layout with AppProviders + Header |
| `templates/blueprints/dapp-rainbowkit/src/app/page.tsx.hbs` | Override: landing page |
| `templates/blueprints/dapp-rainbowkit/src/proxy.ts.hbs` | Override: Next.js middleware with better-auth session cookie |
| `templates/blueprints/dapp-rainbowkit/src/app/protected/layout.tsx.hbs` | New: server-side auth check via auth.api.getSession() |
| `templates/blueprints/dapp-rainbowkit/src/app/protected/page.tsx.hbs` | New: wallet dashboard (address, network, balance) |

### Modified files

| File | Change |
|------|--------|
| `apps/cli/src/__meta__.ts` | Add `dapp-rainbowkit` entry to `META.blueprints` |

### Files NOT overridden (structural templates handle them)

- `trpc/init.ts` — already handles better-auth session via `auth.api.getSession()`
- `trpc/routers/_app.ts` — hello router is sufficient, no custom user router needed
- `lib/db/schema.ts` — better-auth manages user/session/account/verification tables
- No seed script — no custom tables

---

## Chunk 1: META Entry + Auth Overrides

### Task 1: Add META entry

**Files:**
- Modify: `apps/cli/src/__meta__.ts:539-612` (inside `META.blueprints`)

- [ ] **Step 1: Add the blueprint entry after dapp-privy**

Insert after line 581 (closing `},` of `dapp-privy`):

```typescript
    'dapp-rainbowkit': {
      label: 'dApp (RainbowKit)',
      hint: 'Web3 dApp with RainbowKit wallet connection, SIWE auth, and wagmi',
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: ['shadcn', 'next-themes', 'better-auth', 'tanstack-query', 'trpc'],
          },
        ],
        project: {
          database: 'postgres',
          orm: 'drizzle',
          linter: 'biome',
          tooling: [],
        },
      },
      packageJson: {
        dependencies: {
          '@rainbow-me/rainbowkit': '^2.2.0',
          wagmi: '^2.19.0',
          viem: '^2.38.0',
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id',
          monoScope: ['app'],
        },
      ],
    },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/cli && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/__meta__.ts
git commit -m "feat(blueprints): add dapp-rainbowkit META entry"
```

---

### Task 2: Override better-auth server config (add SIWE plugin)

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/lib/auth/auth.ts.hbs`

This overrides `templates/libraries/better-auth/src/lib/auth/auth.ts.hbs` in single-repo mode. Adds the SIWE plugin with viem signature verification. Removes emailAndPassword (web3-only auth).

- [ ] **Step 1: Create the template file**

```handlebars
---
only: single
---
import { db, userAccountTable, userSessionTable, userTable, userVerificationTable } from '@/lib/db';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { generateRandomString } from 'better-auth/crypto';
import { nextCookies } from 'better-auth/next-js';
import { siwe } from 'better-auth/plugins';
import { verifyMessage } from 'viem';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: false,
    schema: {
      user: userTable,
      account: userAccountTable,
      session: userSessionTable,
      verification: userVerificationTable,
    },
  }),

  plugins: [
    nextCookies(),
    siwe({
      domain: new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').host,
      emailDomainName: '{{projectName}}.app',
      getNonce: async () => generateRandomString(32, 'a-z', 'A-Z', '0-9'),
      verifyMessage: async ({ message, signature, address }) => {
        try {
          return await verifyMessage({
            address: address as `0x${string}`,
            message,
            signature: signature as `0x${string}`,
          });
        } catch {
          return false;
        }
      },
    }),
  ],
  user: {
    modelName: 'user',
    fields: {
      name: 'username',
      email: 'email',
      emailVerified: 'emailVerified',
      image: 'avatarUrl',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  session: {
    modelName: 'session',
    fields: {
      userId: 'userId',
      token: 'token',
      expiresAt: 'expiresAt',
      ipAddress: 'ipAddress',
      userAgent: 'userAgent',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    expiresIn: 15 * DAY,
  },
  account: {
    modelName: 'account',
    fields: {
      userId: 'userId',
      accountId: 'accountId',
      providerId: 'providerId',
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
      accessTokenExpiresAt: 'accessTokenExpiresAt',
      refreshTokenExpiresAt: 'refreshTokenExpiresAt',
      scope: 'scope',
      idToken: 'idToken',
      password: 'password',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
  verification: {
    modelName: 'verification',
    fields: {
      identifier: 'identifier',
      value: 'value',
      expiresAt: 'expiresAt',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/lib/auth/auth.ts.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit auth.ts override with SIWE plugin"
```

---

### Task 3: Override better-auth client (add siweClient plugin)

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/lib/auth/auth-client.ts.hbs`

This overrides `templates/libraries/better-auth/src/lib/auth/auth-client.ts.hbs` in single-repo mode. Adds `siweClient()` plugin.

- [ ] **Step 1: Create the template file**

```handlebars
---
only: single
---
import { inferAdditionalFields, siweClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { auth } from './auth';

export const authClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  plugins: [
    inferAdditionalFields<typeof auth>(),
    siweClient(),
  ],
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/lib/auth/auth-client.ts.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit auth-client.ts override with siweClient"
```

---

### Task 4: Create wagmi config

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/lib/wagmi.ts.hbs`

Standard wagmi config via RainbowKit's `getDefaultConfig`. Uses WalletConnect project ID env var.

- [ ] **Step 1: Create the template file**

```handlebars
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mainnet, sepolia } from 'wagmi/chains';

export const wagmiConfig = getDefaultConfig({
  appName: '{{projectName}}',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [mainnet, sepolia],
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/lib/wagmi.ts.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit wagmi config"
```

---

## Chunk 2: Providers + UI Components

### Task 5: Create app-providers.tsx (core integration)

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/components/app-providers.tsx.hbs`

Overrides `templates/stack/nextjs/src/components/app-providers.tsx.hbs`. This is the heart of the integration — bridges RainbowKit's `createAuthenticationAdapter` with better-auth's SIWE client.

**Provider nesting order:**
```
WagmiProvider → TRPCReactProvider (has QueryClientProvider) → RainbowKitAuthenticationProvider → RainbowKitProvider → NextThemesProvider → children
```

**Key integration points:**
- `authClient.useSession()` drives `authenticationStatus` for RainbowKit
- `createAuthenticationAdapter` bridges RainbowKit SIWE flow → better-auth SIWE endpoints
- `createMessage` stores address/chainId for use in `verify` (RainbowKit's verify only passes message + signature)

**NOTE:** The correct API is `authClient.siwe.nonce({ walletAddress })` (not `getNonce()`). Uses wagmi's imperative `getAccount(wagmiConfig)` to get the connected wallet address since RainbowKit calls `getNonce` after wallet connection but before `createMessage`.

- [ ] **Step 1: Create the template file**

```handlebars
'use client';

import '@rainbow-me/rainbowkit/styles.css';
import {
  createAuthenticationAdapter,
  RainbowKitAuthenticationProvider,
  RainbowKitProvider,
} from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { TRPCReactProvider } from '@/trpc/providers';
import { authClient } from '@/lib/auth/auth-client';
import { wagmiConfig } from '@/lib/wagmi';
import { getAccount } from 'wagmi/actions';
import { createSiweMessage } from 'viem/siwe';
import { useMemo } from 'react';
import type React from 'react';

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const { data: session, isPending } = authClient.useSession();

  const authStatus = isPending
    ? 'loading'
    : session
      ? 'authenticated'
      : 'unauthenticated';

  const authAdapter = useMemo(() => {
    let resolvedAddress: string;
    let resolvedChainId: number;

    return createAuthenticationAdapter({
      getNonce: async () => {
        const account = getAccount(wagmiConfig);
        const { data } = await authClient.siwe.nonce({ walletAddress: account.address ?? '' });
        return data?.nonce ?? '';
      },
      createMessage: ({ nonce, address, chainId }) => {
        resolvedAddress = address;
        resolvedChainId = chainId;
        return createSiweMessage({
          domain: window.location.host,
          address,
          statement: 'Sign in with Ethereum.',
          uri: window.location.origin,
          version: '1',
          chainId,
          nonce,
        });
      },
      verify: async ({ message, signature }) => {
        const { error } = await authClient.siwe.verify({
          message,
          signature,
          walletAddress: resolvedAddress,
          chainId: resolvedChainId,
        });
        return !error;
      },
      signOut: async () => {
        await authClient.signOut();
      },
    });
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <TRPCReactProvider>
        <RainbowKitAuthenticationProvider adapter={authAdapter} status={authStatus}>
          <RainbowKitProvider>
            <NextThemesProvider attribute='class' defaultTheme='system' enableSystem storageKey={"{{appName}}-theme"}>
              {children}
            </NextThemesProvider>
          </RainbowKitProvider>
        </RainbowKitAuthenticationProvider>
      </TRPCReactProvider>
    </WagmiProvider>
  );
}
```

**Handlebars note:** Single curly braces (`config={wagmiConfig}`) are NOT interpreted by Handlebars — only double `{{` triggers interpolation. `storageKey={"{{appName}}-theme"}` is intentional Handlebars interpolation for `{{appName}}`.

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/components/app-providers.tsx.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit app-providers with RainbowKit SIWE adapter"
```

---

### Task 6: Create header.tsx

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/components/header.tsx.hbs`

Overrides the stack's default layout (which has no header). Uses RainbowKit's standard `<ConnectButton />` — no custom styling.

- [ ] **Step 1: Create the template file**

```handlebars
'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';

export function Header() {
  return (
    <header className='flex h-14 items-center justify-between border-b px-6'>
      <h2 className='text-lg font-bold'>{{projectName}}</h2>
      <ConnectButton />
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/components/header.tsx.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit header with ConnectButton"
```

---

### Task 7: Create root layout

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/app/layout.tsx.hbs`

Overrides `templates/stack/nextjs/src/app/layout.tsx.hbs`. Adds `AppProviders` wrapper and `Header` component. Same pattern as dapp-privy.

- [ ] **Step 1: Create the template file**

```handlebars
import type { Metadata } from 'next';
import '@/styles/globals.css';
import localFont from 'next/font/local';
import { AppProviders } from '@/components/app-providers';
import { Header } from '@/components/header';

const geistSans = localFont({
  src: '../styles/fonts/geist-sans-vf.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});

const geistMono = localFont({
  src: '../styles/fonts/geist-mono-vf.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: {
    template: '%s | {{projectName}}',
    default: 'Home | {{projectName}}',
  },
  description: '{{projectName}} - Initialized with https://github.com/plvo/create-faster',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        <AppProviders>
          <Header />
          <main>{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/app/layout.tsx.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit root layout"
```

---

## Chunk 3: Pages + Middleware

### Task 8: Create landing page

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/app/page.tsx.hbs`

Overrides `templates/stack/nextjs/src/app/page.tsx.hbs`. Same as dapp-privy — minimal landing page.

- [ ] **Step 1: Create the template file**

```handlebars
export default function HomePage() {
  return (
    <div className='flex min-h-[calc(100vh-3.5rem)] items-center justify-center'>
      <div className='space-y-4 text-center'>
        <h1 className='text-4xl font-bold tracking-tight'>{{projectName}}</h1>
        <p className='text-lg text-muted-foreground'>Connect your wallet to get started</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/app/page.tsx.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit landing page"
```

---

### Task 9: Create middleware (proxy.ts)

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/proxy.ts.hbs`

Same redirect logic as dapp-privy but checks `better-auth.session_token` cookie instead of `privy-token`. This is a lightweight cookie-existence check for redirects — the protected layout does full session verification.

- [ ] **Step 1: Create the template file**

```handlebars
import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = ['/'];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route);
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get('better-auth.session_token');
  const isAuthenticated = Boolean(token);

  if (!isAuthenticated && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (isAuthenticated && isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL('/protected', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|manifest.webmanifest|_next/image|.*\\.png$).*)'],
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/proxy.ts.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit middleware"
```

---

### Task 10: Create protected layout

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/app/protected/layout.tsx.hbs`

Server-side auth check using `auth.api.getSession()`. Full session verification (not just cookie existence).

- [ ] **Step 1: Create the template file**

```handlebars
import { auth } from '@/lib/auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect('/');

  return children;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/app/protected/layout.tsx.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit protected layout"
```

---

### Task 11: Create protected page (dashboard)

**Files:**
- Create: `apps/cli/templates/blueprints/dapp-rainbowkit/src/app/protected/page.tsx.hbs`

Wallet dashboard showing address, network, balance via wagmi hooks. Session info from better-auth. No tRPC user sync needed — better-auth creates the user on SIWE verify.

- [ ] **Step 1: Create the template file**

```handlebars
'use client';

import { useAccount, useBalance } from 'wagmi';
import { formatEther } from 'viem';
import { authClient } from '@/lib/auth/auth-client';

export default function ProtectedPage() {
  const { address, chain } = useAccount();
  const { data: balance } = useBalance({ address });
  const { data: session } = authClient.useSession();

  return (
    <div className='container mx-auto space-y-6 p-6'>
      <h1 className='text-3xl font-bold'>Dashboard</h1>

      <div className='grid gap-4 md:grid-cols-3'>
        <div className='rounded-lg border bg-card p-6'>
          <p className='text-sm text-muted-foreground'>Wallet</p>
          <p className='mt-2 font-mono text-lg'>
            {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}
          </p>
        </div>

        <div className='rounded-lg border bg-card p-6'>
          <p className='text-sm text-muted-foreground'>Network</p>
          <p className='mt-2 text-lg'>{chain?.name ?? 'Unknown'}</p>
        </div>

        <div className='rounded-lg border bg-card p-6'>
          <p className='text-sm text-muted-foreground'>Balance</p>
          <p className='mt-2 text-lg'>
            {balance ? `${formatEther(balance.value)} ${balance.symbol}` : '\u2014'}
          </p>
        </div>
      </div>

      {session?.user && (
        <div className='rounded-lg border bg-card p-6'>
          <p className='text-sm text-muted-foreground'>Session</p>
          <p className='mt-2 font-mono text-sm'>{session.user.name ?? 'Authenticated'}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/templates/blueprints/dapp-rainbowkit/src/app/protected/page.tsx.hbs
git commit -m "feat(blueprints): add dapp-rainbowkit protected dashboard page"
```

---

## Chunk 4: Integration Testing

### Task 12: Test single-repo generation

- [ ] **Step 1: Verify TypeScript compiles**

Run: `cd /home/ttecim/.lab/create-faster-br/apps/cli && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Generate a test project with --blueprint flag**

Run: `cd /tmp && bun run /home/ttecim/.lab/create-faster-br/apps/cli/src/index.ts test-rainbowkit --blueprint dapp-rainbowkit --git --pm bun`
Expected: Project generated at `/tmp/test-rainbowkit`

- [ ] **Step 3: Verify generated files exist**

Check that these files exist in the generated project:
- `src/lib/auth/auth.ts` — should contain `siwe(` (SIWE plugin)
- `src/lib/auth/auth-client.ts` — should contain `siweClient()`
- `src/lib/wagmi.ts` — should contain `getDefaultConfig`
- `src/components/app-providers.tsx` — should contain `RainbowKitProvider`
- `src/components/header.tsx` — should contain `ConnectButton`
- `src/app/layout.tsx` — should contain `AppProviders`
- `src/app/page.tsx` — should contain `Connect your wallet`
- `src/proxy.ts` — should contain `better-auth.session_token`
- `src/app/protected/layout.tsx` — should contain `auth.api.getSession`
- `src/app/protected/page.tsx` — should contain `useAccount`
- `package.json` — should contain `@rainbow-me/rainbowkit`, `wagmi`, `viem`
- `.env.example` — should contain `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

- [ ] **Step 4: Verify bun install succeeds**

Run: `cd /tmp/test-rainbowkit && bun install`
Expected: No errors

- [ ] **Step 5: Verify the app builds (or at least starts)**

Run: `cd /tmp/test-rainbowkit && bun run build` (or `bun run dev` with a timeout)
Expected: No TypeScript or import errors

- [ ] **Step 6: Verify interactive mode lists the blueprint**

Run: `cd /tmp && bun run /home/ttecim/.lab/create-faster-br/apps/cli/src/index.ts` (interactive, check the blueprint appears in selection)

- [ ] **Step 7: Clean up test project**

Run: `rm -rf /tmp/test-rainbowkit`

- [ ] **Step 8: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(blueprints): dapp-rainbowkit template adjustments from testing"
```

---

## Notes

### WalletConnect Project ID
RainbowKit's `getDefaultConfig` requires a WalletConnect Cloud project ID for WalletConnect-based wallets (QR scanning). This was discovered during implementation research — the design spec originally said "Extra envs: None". The env var `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` has been added to the META entry.

### better-auth SIWE client API
The correct API is `authClient.siwe.nonce({ walletAddress, chainId? })` — not `getNonce()`. The `walletAddress` parameter is required. Since RainbowKit's `getNonce` callback provides no parameters, we use wagmi's imperative `getAccount(wagmiConfig)` to get the connected wallet address (wallet is always connected by the time SIWE flow starts). `authClient.siwe.verify()` works as expected.

### Single-repo only
All blueprint overrides use `only: single` (or no frontmatter, which defaults to both). This matches the dapp-privy pattern. Turborepo support would require additional overrides for package-scoped files.

### Package versions
`@rainbow-me/rainbowkit@^2.2.0`, `wagmi@^2.19.0`, `viem@^2.38.0` — aligned with RainbowKit v2.2.x changelog (wagmi ^2.19.3, viem 2.38.0). Note: dapp-privy uses `wagmi@^3.5.0` but that's `@privy-io/wagmi` (Privy-specific fork), not standard wagmi. RainbowKit v2 uses standard wagmi v2. Verify latest stable versions against npm during implementation.
