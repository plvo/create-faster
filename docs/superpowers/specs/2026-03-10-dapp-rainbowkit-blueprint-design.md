# Blueprint: dapp-rainbowkit

Web3 dApp blueprint using RainbowKit (open-source wallet connection) + better-auth SIWE plugin for server-side authentication. Mirrors the dapp-privy blueprint route structure but with fully open-source auth.

## Composition

| Element | Value |
|---------|-------|
| Stack | Next.js |
| Libraries | shadcn, next-themes, better-auth, tanstack-query, trpc |
| Database | PostgreSQL |
| ORM | Drizzle |
| Linter | Biome |
| Extra deps (blueprint) | `@rainbow-me/rainbowkit`, `wagmi`, `viem` |
| Extra envs | None |

## Routes

| Route | Type | Behavior |
|-------|------|----------|
| `/` | Public | Landing page — "Connect your wallet to get started" |
| `/protected` | Authenticated (SIWE) | Dashboard — wallet address, network, balance |

## Auth Flow

1. User clicks `<ConnectButton />` (RainbowKit standard component)
2. RainbowKit modal opens → wallet selection → connection
3. SIWE signature request via `createAuthenticationAdapter`
4. Adapter calls better-auth SIWE endpoints (nonce → verify)
5. better-auth creates user + session + cookie
6. Middleware (`proxy.ts`) detects session → redirects to `/protected`

## Integration Architecture

### better-auth SIWE plugin (server)

```typescript
import { siwe } from "better-auth/plugins";
import { verifyMessage } from "viem";
import { generateRandomString } from "better-auth/crypto";

// Added to existing better-auth config
plugins: [
  nextCookies(),
  siwe({
    domain: "localhost:3000",
    getNonce: async () => generateRandomString(32, "a-z", "A-Z", "0-9"),
    verifyMessage: async ({ message, signature, address }) => {
      return verifyMessage({ address, message, signature });
    },
  }),
]
```

### better-auth SIWE client plugin

```typescript
import { siweClient } from "better-auth/client/plugins";

// Added to existing better-auth auth-client config
plugins: [
  inferAdditionalFields<typeof auth>(),
  siweClient(),
]
```

### RainbowKit authentication adapter

```typescript
import { createAuthenticationAdapter } from '@rainbow-me/rainbowkit';
import { createSiweMessage } from 'viem/siwe';

const authenticationAdapter = createAuthenticationAdapter({
  getNonce: async () => { /* call better-auth nonce endpoint */ },
  createMessage: ({ nonce, address, chainId }) => {
    return createSiweMessage({ domain: window.location.host, address, nonce, chainId, ... });
  },
  verify: async ({ message, signature }) => { /* call authClient.siwe.verify() */ },
  signOut: async () => { /* call authClient.signOut() */ },
});
```

### Provider stack (AppProviders)

```
WagmiProvider
  └── QueryClientProvider
       └── RainbowKitAuthenticationProvider (adapter + status)
            └── RainbowKitProvider
                 └── TRPCReactProvider
                      └── NextThemesProvider
                           └── {children}
```

## Template File Tree

```
templates/blueprints/dapp-rainbowkit/
├── src/
│   ├── app/
│   │   ├── layout.tsx.hbs              # Override: root layout with AppProviders + Header
│   │   ├── page.tsx.hbs                # Override: landing page
│   │   └── protected/
│   │       ├── layout.tsx.hbs          # Auth check via better-auth session
│   │       └── page.tsx.hbs            # Dashboard: wallet info (useAccount, useBalance)
│   ├── components/
│   │   ├── app-providers.tsx.hbs       # RainbowKit + WagmiProvider + SIWE adapter
│   │   └── header.tsx.hbs              # <ConnectButton /> standard
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── auth.ts.hbs            # Override: add siwe() plugin to better-auth
│   │   │   └── auth-client.ts.hbs     # Override: add siweClient() plugin
│   │   └── wagmi.ts.hbs               # Standard wagmi config (mainnet + sepolia)
│   ├── proxy.ts.hbs                    # Middleware: better-auth session cookie check
│   └── trpc/
│       ├── init.ts.hbs                 # Context: auth.api.getSession()
│       └── routers/
│           └── user.ts.hbs            # Query user via better-auth session
```

## Key Differences vs dapp-privy

| Aspect | dapp-privy | dapp-rainbowkit |
|--------|-----------|----------------|
| Auth provider | Privy (SaaS) | better-auth + SIWE (open source) |
| Wallet UI | Privy modal | RainbowKit ConnectButton |
| Session | `privy-token` cookie, `@privy-io/server-auth` | better-auth session cookie |
| User storage | Custom `users` table with `privyId` | better-auth native tables |
| Schema | Custom `schema.ts` override | No schema override needed |
| tRPC context | Manual `privy-token` parsing | `auth.api.getSession()` |
| wagmi config | `@privy-io/wagmi` `createConfig()` | Standard `wagmi` `createConfig()` |
| Env vars | 3 Privy vars | 0 extra (better-auth provides its own) |
| Extra deps | 5 Privy packages | 3 packages (rainbowkit, wagmi, viem) |

## META Entry

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
      wagmi: '^2.14.0',
      viem: '^2.21.0',
    },
  },
},
```

## Decisions

- **All web3 deps in blueprint packageJson** — not in better-auth library META. SIWE is blueprint-specific, not a general better-auth concern.
- **Standard ConnectButton** — no custom shadcn styling. Users can customize after scaffolding.
- **No custom schema** — better-auth manages user/account/session/verification tables natively.
- **No seed script** — no custom tables to seed.
- **`only: single` on tRPC overrides** — same pattern as dapp-privy for single-repo tRPC files.
