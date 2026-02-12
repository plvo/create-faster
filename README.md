<img src="https://create.plvo.dev/cf-title-dark.png" alt="Create Faster">

A modern CLI scaffolding tool that generates production-ready full-stack projects with multiple framework combinations. Unlike traditional scaffolding tools, create-faster enables you to create multiple applications simultaneously with automatic monorepo orchestration.

Visit https://create.plvo.dev/docs for more details.

## Key Features

- **Multiple frameworks**: Next.js, Expo, TanStack Start, Hono
- **Automatic monorepo**: Turborepo configuration for 2+ apps
- **Modular system**: 11+ optional modules (shadcn/ui, Better Auth, TanStack Query, MDX, PWA, etc.)
- **Database support**: PostgreSQL, MySQL with Prisma or Drizzle ORM
- **Linters**: Biome or ESLint with stack-specific configs
- **Developer tools**: Husky git hooks
- **Dual modes**: Interactive prompts or CLI flags for automation
- **Type-safe**: Full TypeScript support with strict configuration
- **Auto-generated CLI commands**: Copy-paste ready command to recreate projects

*More features coming soon, check [the roadmap](https://create.plvo.dev/docs/roadmap) for more details.*

## Usage Examples

### Interactive Mode

```bash
# Using your favorite package manager
npm create faster
pnpm create faster
bun create faster
```

### Single Application

Create a Next.js app with shadcn/ui and TanStack Query, using PostgreSQL with Drizzle:

```bash
bunx create-faster myapp \
  --app myapp:nextjs:shadcn,tanstack-query \
  --database postgres \
  --orm drizzle \
  --linter biome \
  --tooling husky \
  --git \
  --pm bun
```

### Multi-App Monorepo

Create a full-stack SaaS project with web (Next.js), mobile (Expo), and API (Hono) in a turborepo:

```bash
bunx create-faster mysaas \
  --app web:nextjs:shadcn,mdx,better-auth \
  --app mobile:expo:nativewind \
  --app api:hono \
  --database postgres \
  --orm drizzle \
  --linter eslint \
  --tooling husky \
  --git \
  --pm bun
```


## Links

- [Website](https://create.plvo.dev)
- [Repository](https://github.com/plvo/create-faster)
- [Issues](https://github.com/plvo/create-faster/issues)
- [npm Package](https://www.npmjs.com/package/create-faster)

## License

[MIT](LICENSE) © [plvo](https://github.com/plvo)
