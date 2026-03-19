# Org Dashboard

> Dashboard with auth, RBAC, admin panel, and example CRUD

## Presentation

A production-ready dashboard starter with authentication, role-based access control, admin panel, and a complete CRUD example. Ships as a turborepo with a Next.js web app, a Node batch worker, and shared packages for database, auth, API, and UI. Designed as a foundation for any internal tool or organization dashboard.

## Composition

**Apps:**
- `web` — Next.js + shadcn/ui, better-auth, tRPC, TanStack Query, TanStack Devtools, TanStack Form, next-themes
- `batch` — Node (background worker)

**Project addons:**
- Database: PostgreSQL
- ORM: Drizzle

## Architecture

### Turborepo structure

```
apps/
  web/              # Next.js app
  batch/            # Node worker
packages/
  api/              # tRPC routers
  auth/             # better-auth config + types
  db/               # Drizzle schema + client
  ui/               # shadcn components
  config/           # Shared tsconfig
scripts/
  seed.ts           # Database seeder (admin + user)
```

### Blueprint-specific files (web app)

```
src/
├── app/
│   ├── layout.tsx                        # Root layout with AppProviders + Toaster
│   ├── (auth)/
│   │   ├── layout.tsx                    # Auth guard (redirect if logged in)
│   │   └── login/
│   │       ├── page.tsx
│   │       └── login-form.tsx            # Email/password login form
│   └── (dashboard)/
│       ├── layout.tsx                    # Sidebar + auth guard + session check
│       ├── page.tsx                      # Dashboard home (contact count)
│       ├── admin/users/
│       │   ├── page.tsx                  # User list (admin only)
│       │   └── [id]/
│       │       ├── page.tsx              # User detail
│       │       └── user-detail.tsx       # Edit user + generate password
│       ├── contacts/
│       │   ├── page.tsx                  # Contact list
│       │   └── [id]/page.tsx             # Contact detail + edit
│       └── profile/
│           ├── layout.tsx                # Tab navigation + ViewTransition
│           ├── page.tsx                  # Redirect → /profile/account
│           ├── account/page.tsx          # Account info + edit name
│           ├── security/page.tsx         # Change password
│           ├── sessions/page.tsx         # Active sessions + revoke
│           └── preferences/page.tsx      # Theme switcher
├── components/
│   ├── admin/                            # Create user dialog, user actions, user table
│   ├── contacts/                         # Contact dialog, form, table
│   ├── navigation/                       # Sidebar, header, breadcrumbs, nav-user dropdown
│   ├── profile/                          # Account form, security form, session list, preferences, tab nav
│   ├── query-boundary.tsx                # Suspense + ErrorBoundary + QueryErrorResetBoundary
│   └── ui/                               # Sidebar, breadcrumb, dropdown-menu, sheet, tooltip, etc.
├── lib/
│   └── constants.ts                      # Route definitions (admin vs user routes)
└── styles/
    └── globals.css                       # @import base.css + slide animations
```

### API package (packages/api)

```
src/
├── root.ts                   # App router (user, contact, session)
├── trpc.ts                   # tRPC init with auth context + headers
├── middleware/
│   └── rbac.ts               # adminProcedure + userProcedure
└── router/
    ├── user.ts               # me, list, getById, edit, generatePassword
    ├── contact.ts            # list, getById, create, update, delete, count
    └── session.ts            # list, revoke, revokeOthers
```

### Auth package (packages/auth)

```
src/
├── auth.ts                   # better-auth config (admin plugin, drizzle adapter)
├── auth-client.ts            # Client with adminClient + inferAdditionalFields
├── types.ts                  # Session type via auth.$Infer.Session
└── password.ts               # Cryptographic password generation
```

## What's included

### Authentication

Email/password login with better-auth. The admin plugin provides role-based access (admin/user), ban/unban, and session management. Auth layout redirects authenticated users away from login. Dashboard layout requires authentication and a valid role.

### Role-Based Access Control

Two roles: `admin` and `user`. Admin-only routes (`/admin/users`) use `adminProcedure` in tRPC. The sidebar dynamically shows routes based on role — admins see the "Administration" section with user management.

### Admin Panel

User list with clickable rows linking to detail pages. User detail page allows editing username, name, phone, and generating one-time passwords (visible once, must be copied). User actions include role assignment (admin/user) and ban/unban.

### CRUD Example (Contacts)

Full create, read, update, delete for contacts. Contact form with validation (TanStack Form + Zod). Contact list with link to detail/edit page.

### Profile with View Transitions

Route-based profile tabs using React 19 `ViewTransition` API with directional slide animations. Four sections:
- **Account** — user info (email, role, joined date) + edit display name
- **Security** — change password (revokes other sessions)
- **Sessions** — list active sessions with device/IP info, revoke individual or all others
- **Preferences** — theme switcher (light/dark/system)

### QueryBoundary

Reusable component wrapping `Suspense` + `ErrorBoundary` + `QueryErrorResetBoundary`. Used throughout for tRPC prefetch error handling with retry UI.

### Database Seed

Creates two users via better-auth's admin API:
- `admin@example.com` / `password` (role: admin)
- `user@example.com` / `password` (role: user)

## Extra dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| lucide-react | ^0.487.0 | Icons in navigation, forms, session list |
| react-error-boundary | ^5.0.0 | QueryBoundary error handling |
| sonner | ^2.0.7 | Toast notifications |
| zod | ^4.2.1 | Form validation schemas |

## Root scripts

| Script | Command | Purpose |
|--------|---------|---------|
| db:push | turbo db:push | Push schema to database |
| db:generate | turbo db:generate | Generate migration files |
| db:migrate | turbo db:migrate | Apply migrations |
| db:studio | turbo db:studio | Open Drizzle Studio |
| db:seed | bun scripts/seed.ts | Seed admin + user |
| start | turbo start | Start production server |

## CLI usage

```bash
bunx create-faster myproject --blueprint org-dashboard --linter biome --git --pm bun
```

## Getting started

```bash
# Generate project
bunx create-faster myproject --blueprint org-dashboard --linter biome --git --pm bun

# Start database
cd myproject
docker compose up -d

# Set environment
cp apps/web/.env.example apps/web/.env
cp packages/auth/.env.example packages/auth/.env
cp packages/db/.env.example packages/db/.env

# Push schema + seed
bun run db:push
bun run db:seed

# Start dev server
bun run dev
```
