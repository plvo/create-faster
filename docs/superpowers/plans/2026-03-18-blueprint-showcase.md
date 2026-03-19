# Blueprint "showcase" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "showcase" blueprint to create-faster that generates a fully functional, SEO/GEO-optimized SaaS landing page with blog, programmatic persona pages, and analytics — using "PigeonPost" as an absurd example brand.

**Architecture:** Blueprint composes `nextjs + shadcn + mdx` (no database/ORM). Adds `@posthog/next` for analytics and `next-sitemap` for sitemap/robots.txt generation. Overrides the stack's `page.tsx`, `layout.tsx`, and `proxy.ts` templates. Adds new pages (about, blog, contact, `/for/[persona]`) and SEO components (JSON-LD, breadcrumbs, FAQ with schema).

**Tech Stack:** Next.js 16 (App Router), shadcn/ui, @next/mdx, @posthog/next, next-sitemap, Handlebars templates.

**Context7 Research Findings (verified):**
- `@posthog/next` — uses `PostHogProvider` + `PostHogPageView` in layout, `postHogMiddleware({ proxy: true })` composed in `proxy.ts`, env: `NEXT_PUBLIC_POSTHOG_KEY`
- `@next/mdx` — already in META library `mdx`, uses `next-mdx-remote/rsc` for rendering, custom `parseFrontmatter()` for YAML frontmatter
- `next-sitemap` — config in `next-sitemap.config.js`, `postbuild: next-sitemap` script, `siteUrl` from env, generates sitemap.xml + robots.txt
- Next.js 16 uses `proxy.ts` (not `middleware.ts`), exported function name is `proxy` (not `middleware`)

**Handlebars helpers available:** `eq`, `ne`, `and`, `or`, `isMono`, `hasLibrary`, `has`, `hasContext`, `camelCase`, `raw`, `appPort`
**Escape pattern for JSX double braces:** `\{{` (e.g., `style=\{{ color: 'red' }}`)

---

## File Structure

All files live under `apps/cli/templates/blueprints/showcase/` unless noted. The META entry goes in `apps/cli/src/__meta__.ts`.

### Overrides (replace stack/library templates at same destination path)

| File | Overrides | Purpose |
|------|-----------|---------|
| `src/app/layout.tsx.hbs` | `stack/nextjs/src/app/layout.tsx.hbs` | Add PostHog provider, JSON-LD Organization+WebSite schema |
| `src/app/page.tsx.hbs` | `stack/nextjs/src/app/page.tsx.hbs` | Showcase homepage (hero, features, social proof, FAQ, CTA) |
| `src/proxy.ts.hbs` | `stack/nextjs/src/proxy.ts.hbs` | Add PostHog proxy middleware composition |
| `src/components/app-providers.tsx.hbs` | `stack/nextjs/src/components/app-providers.tsx.hbs` | Add PostHogProvider wrapping |

### Additions (new files)

| File | Purpose |
|------|---------|
| `next-sitemap.config.js.hbs` | Sitemap + robots.txt configuration |
| `src/app/about/page.tsx.hbs` | About page (team, mission, E-E-A-T) |
| `src/app/blog/page.tsx.hbs` | Blog index (list MDX articles) |
| `src/app/blog/[slug]/page.tsx.hbs` | Blog article page (MDX render + Article schema) |
| `src/app/for/[persona]/page.tsx.hbs` | Programmatic persona pages |
| `src/app/contact/page.tsx.hbs` | Contact form page |
| `src/components/seo/json-ld.tsx.hbs` | JSON-LD schema components (Organization, WebSite, BreadcrumbList, FAQPage, Article) |
| `src/components/seo/breadcrumbs.tsx.hbs` | Breadcrumbs navigation + BreadcrumbList schema |
| `src/components/sections/hero.tsx.hbs` | Hero section component |
| `src/components/sections/features.tsx.hbs` | Features grid component |
| `src/components/sections/social-proof.tsx.hbs` | Logos + testimonials component |
| `src/components/sections/faq.tsx.hbs` | FAQ section + FAQPage schema |
| `src/components/sections/cta.tsx.hbs` | CTA section component |
| `src/components/layout/header.tsx.hbs` | Site header + navigation |
| `src/components/layout/footer.tsx.hbs` | Site footer (SEO links, legal) |
| `src/lib/blog.ts.hbs` | Blog utilities (list posts, get post by slug) |
| `src/lib/personas.ts.hbs` | Persona data + types |
| `src/lib/site-config.ts.hbs` | Site-wide config (name, description, URL, nav links, social links) |
| `contents/blog/getting-started-with-pigeon-logistics.mdx` | Example blog article |
| `contents/blog/why-carrier-pigeons-beat-email.mdx` | Example blog article |

### META entry

| File | Change |
|------|--------|
| `apps/cli/src/__meta__.ts` | Add `showcase` to `META.blueprints` |

---

## Task 1: META Entry

**Files:**
- Modify: `apps/cli/src/__meta__.ts:763` (before closing `},` of blueprints)

- [ ] **Step 1: Add showcase blueprint to META.blueprints**

Insert before the closing `},` of the blueprints object (line 763 in `__meta__.ts`):

```typescript
    showcase: {
      label: 'Showcase',
      hint: 'SEO/GEO-optimized SaaS landing page with blog and programmatic pages',
      category: 'Business',
      context: {
        apps: [
          {
            appName: 'web',
            stackName: 'nextjs',
            libraries: ['shadcn', 'mdx'],
          },
        ],
        project: {},
      },
      packageJson: {
        dependencies: {
          '@posthog/next': '^1.0.0',
          'next-sitemap': '^4.2.3',
        },
        scripts: {
          postbuild: 'next-sitemap',
        },
      },
      envs: [
        {
          value: 'NEXT_PUBLIC_POSTHOG_KEY=phc_your-posthog-project-key',
          monoScope: ['app'],
        },
        {
          value: 'NEXT_PUBLIC_SITE_URL=http://localhost:3000',
          monoScope: ['app'],
        },
      ],
    },
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd apps/cli && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/__meta__.ts
git commit -m "feat(showcase): add showcase blueprint META entry"
```

---

## Task 2: Site Config + Data Layer

**Files:**
- Create: `apps/cli/templates/blueprints/showcase/src/lib/site-config.ts.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/lib/personas.ts.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/lib/blog.ts.hbs`

- [ ] **Step 1: Create site-config.ts.hbs**

This is the single source of truth for all site-wide data (name, description, nav links, social links). Every page references this.

```handlebars
export const siteConfig = {
  name: '{{projectName}}',
  description: 'Carrier pigeon logistics for the modern enterprise. Deliver messages at the speed of bird.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ogImage: '/og.png',
  navLinks: [
    { label: 'Features', href: '/#features' },
    { label: 'Blog', href: '/blog' },
    { label: 'About', href: '/about' },
    { label: 'Contact', href: '/contact' },
  ],
  footerLinks: {
    product: [
      { label: 'Features', href: '/#features' },
      { label: 'For Logistics Teams', href: '/for/logistics-teams' },
      { label: 'For Bird Enthusiasts', href: '/for/bird-enthusiasts' },
      { label: 'For Enterprise', href: '/for/enterprise' },
    ],
    company: [
      { label: 'About', href: '/about' },
      { label: 'Blog', href: '/blog' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  social: {
    twitter: 'https://x.com/pigeonpost',
    github: 'https://github.com/pigeonpost',
    linkedin: 'https://linkedin.com/company/pigeonpost',
  },
};

export type SiteConfig = typeof siteConfig;
```

- [ ] **Step 2: Create personas.ts.hbs**

Persona data for the `/for/[persona]` programmatic pages. Each persona has unique hero, benefits, and FAQ content for GEO optimization.

```handlebars
export interface Persona {
  slug: string;
  title: string;
  headline: string;
  description: string;
  benefits: { title: string; description: string }[];
  faq: { question: string; answer: string }[];
}

export const personas: Persona[] = [
  {
    slug: 'logistics-teams',
    title: 'For Logistics Teams',
    headline: 'Replace your fragile supply chain comms with carrier pigeons',
    description: 'Purpose-bred homing pigeons deliver critical logistics updates with 99.7% delivery rate. No cell towers. No Wi-Fi. Just wings.',
    benefits: [
      {
        title: 'Zero downtime delivery',
        description: 'Pigeons operate in all weather conditions. Rain, snow, solar flares — your messages get through when Slack goes down.',
      },
      {
        title: 'Real-time flock tracking',
        description: 'GPS-tagged pigeons with live dashboard. Know exactly where your message is, down to the wingspan.',
      },
      {
        title: 'Warehouse integration',
        description: 'Our pigeon lofts integrate with your existing warehouse layout. Automated message capsule loading and unloading.',
      },
    ],
    faq: [
      {
        question: 'How fast can a carrier pigeon deliver a message?',
        answer: 'Our enterprise-grade pigeons cruise at 60mph and can cover up to 600 miles in a single flight. For local deliveries under 50 miles, expect sub-hour delivery times.',
      },
      {
        question: 'What happens if a pigeon gets lost?',
        answer: 'Each pigeon is GPS-tagged with automatic re-routing. If a bird deviates more than 5% from the planned route, a backup pigeon is dispatched immediately. Our SLA guarantees 99.7% delivery rate.',
      },
    ],
  },
  {
    slug: 'bird-enthusiasts',
    title: 'For Bird Enthusiasts',
    headline: 'Turn your passion for birds into productive communication',
    description: 'You already love pigeons. Now make them work for you. PigeonPost brings professional-grade avian messaging to hobbyists and breeders.',
    benefits: [
      {
        title: 'Breed tracking dashboard',
        description: 'Track lineage, flight stats, and message delivery records for every bird in your flock.',
      },
      {
        title: 'Community flock sharing',
        description: 'Connect with other pigeon enthusiasts. Share routes, trade birds, and collaborate on long-distance relay networks.',
      },
      {
        title: 'Training programs',
        description: 'AI-powered training schedules that optimize your pigeons flight performance based on weather patterns and genetics.',
      },
    ],
    faq: [
      {
        question: 'Do I need special breeds for PigeonPost?',
        answer: 'While any homing pigeon can work, we recommend starting with Racing Homers or English Carriers for best results. Our onboarding includes a breed compatibility assessment.',
      },
      {
        question: 'Can I use my existing pigeons?',
        answer: 'Absolutely! Our onboarding program evaluates your existing flock and provides personalized training plans. Most pigeons are delivery-ready within 2-4 weeks.',
      },
    ],
  },
  {
    slug: 'enterprise',
    title: 'For Enterprise',
    headline: 'Air-gapped message delivery that no firewall can block',
    description: 'When your board demands communication infrastructure that is truly unhackable, there is only one answer: birds.',
    benefits: [
      {
        title: 'Zero-trust by nature',
        description: 'No digital footprint. No packets to intercept. No servers to breach. A pigeon carrying an encrypted capsule is the ultimate air-gapped communication.',
      },
      {
        title: 'Regulatory compliance',
        description: 'Meets GDPR, HIPAA, and SOC2 requirements by default — data in transit is literally in the air, stored on paper, and shredded on delivery.',
      },
      {
        title: 'Dedicated flock SLA',
        description: 'Enterprise plans include a dedicated pigeon flock, private lofts on your campus, and 24/7 avian support team.',
      },
    ],
    faq: [
      {
        question: 'How does PigeonPost handle message encryption?',
        answer: 'Messages are encrypted before being printed on microfilm and loaded into tamper-evident capsules. The pigeon itself has no knowledge of the message content — true zero-knowledge architecture.',
      },
      {
        question: 'What is the enterprise SLA?',
        answer: 'Enterprise plans guarantee 99.9% delivery rate with a maximum 4-hour delivery window for distances under 200 miles. Dedicated account pigeons are assigned to your organization.',
      },
    ],
  },
];

export function getPersona(slug: string): Persona | undefined {
  return personas.find((p) => p.slug === slug);
}

export function getAllPersonaSlugs(): string[] {
  return personas.map((p) => p.slug);
}
```

- [ ] **Step 3: Create blog.ts.hbs**

Blog utilities for listing and loading MDX posts. Uses the existing `parseFrontmatter` from the MDX library.

```handlebars
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '@/lib/mdx';

const BLOG_DIR = path.join(process.cwd(), 'contents', 'blog');

export interface BlogPost {
  slug: string;
  title: string;
  summary: string;
  publishedAt: string;
  imageUrl?: string;
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith('.mdx'));

  return files
    .map((file) => {
      const content = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
      const { metadata } = parseFrontmatter(content);

      return {
        slug: file.replace('.mdx', ''),
        title: metadata.title ?? file.replace('.mdx', ''),
        summary: metadata.summary ?? '',
        publishedAt: metadata.publishedAt ?? '',
        imageUrl: metadata.imageUrl,
      };
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export function getPost(slug: string): { metadata: BlogPost; content: string } | null {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { metadata, content } = parseFrontmatter(raw);

  return {
    metadata: {
      slug,
      title: metadata.title ?? slug,
      summary: metadata.summary ?? '',
      publishedAt: metadata.publishedAt ?? '',
      imageUrl: metadata.imageUrl,
    },
    content,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/cli/templates/blueprints/showcase/src/lib/
git commit -m "feat(showcase): add site config, persona data, and blog utilities"
```

---

## Task 3: SEO Components

**Files:**
- Create: `apps/cli/templates/blueprints/showcase/src/components/seo/json-ld.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/components/seo/breadcrumbs.tsx.hbs`

- [ ] **Step 1: Create json-ld.tsx.hbs**

Reusable JSON-LD schema components for Organization, WebSite, BreadcrumbList, FAQPage, and Article. Each renders a `<script type="application/ld+json">` tag.

```handlebars
import { siteConfig } from '@/lib/site-config';

interface BreadcrumbItem {
  name: string;
  href: string;
}

interface FaqItem {
  question: string;
  answer: string;
}

interface ArticleProps {
  title: string;
  description: string;
  publishedAt: string;
  url: string;
  imageUrl?: string;
}

function JsonLdScript({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML=\{{ __html: JSON.stringify(data) }}
    />
  );
}

export function OrganizationJsonLd() {
  return (
    <JsonLdScript
      data=\{{
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: siteConfig.name,
        url: siteConfig.url,
        logo: `${siteConfig.url}/logo.png`,
        sameAs: Object.values(siteConfig.social),
      }}
    />
  );
}

export function WebSiteJsonLd() {
  return (
    <JsonLdScript
      data=\{{
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteConfig.name,
        url: siteConfig.url,
      }}
    />
  );
}

export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  return (
    <JsonLdScript
      data=\{{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: `${siteConfig.url}${item.href}`,
        })),
      }}
    />
  );
}

export function FaqJsonLd({ items }: { items: FaqItem[] }) {
  return (
    <JsonLdScript
      data=\{{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.answer,
          },
        })),
      }}
    />
  );
}

export function ArticleJsonLd({ title, description, publishedAt, url, imageUrl }: ArticleProps) {
  return (
    <JsonLdScript
      data=\{{
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: title,
        description,
        datePublished: publishedAt,
        url: `${siteConfig.url}${url}`,
        ...(imageUrl ? { image: `${siteConfig.url}${imageUrl}` } : {}),
        author: {
          '@type': 'Organization',
          name: siteConfig.name,
        },
        publisher: {
          '@type': 'Organization',
          name: siteConfig.name,
          logo: {
            '@type': 'ImageObject',
            url: `${siteConfig.url}/logo.png`,
          },
        },
      }}
    />
  );
}
```

- [ ] **Step 2: Create breadcrumbs.tsx.hbs**

Navigation breadcrumbs with integrated BreadcrumbList JSON-LD schema.

```handlebars
import Link from 'next/link';
import { BreadcrumbJsonLd } from '@/components/seo/json-ld';

interface BreadcrumbItem {
  name: string;
  href: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const allItems = [{ name: 'Home', href: '/' }, ...items];

  return (
    <>
      <BreadcrumbJsonLd items={allItems} />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground mb-6">
        <ol className="flex items-center gap-1.5">
          {allItems.map((item, index) => (
            <li key={item.href} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">/</span>}
              {index === allItems.length - 1 ? (
                <span aria-current="page" className="text-foreground font-medium">
                  {item.name}
                </span>
              ) : (
                <Link href={item.href} className="hover:text-foreground transition-colors">
                  {item.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/showcase/src/components/seo/
git commit -m "feat(showcase): add JSON-LD schema and breadcrumb components"
```

---

## Task 4: Layout Components (Header + Footer)

**Files:**
- Create: `apps/cli/templates/blueprints/showcase/src/components/layout/header.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/components/layout/footer.tsx.hbs`

- [ ] **Step 1: Create header.tsx.hbs**

Responsive site header with navigation. Uses shadcn Button.

```handlebars
'use client';

import Link from 'next/link';
import { useState } from 'react';
{{#if (isMono)}}
import { Button } from '@repo/ui/components/button';
{{else}}
import { Button } from '@/components/ui/button';
{{/if}}
import { siteConfig } from '@/lib/site-config';

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="text-xl font-bold">
          {siteConfig.name}
        </Link>

        <nav className="hidden md:flex items-center gap-6">
          {siteConfig.navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
          <Button asChild size="sm">
            <Link href="/contact">Get Started</Link>
          </Button>
        </nav>

        <button
          type="button"
          className="md:hidden p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {mobileOpen ? (
              <path d="M18 6 6 18M6 6l12 12" />
            ) : (
              <path d="M4 12h16M4 6h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <nav className="md:hidden border-t px-4 py-4 space-y-3">
          {siteConfig.navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <Button asChild size="sm" className="w-full">
            <Link href="/contact">Get Started</Link>
          </Button>
        </nav>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Create footer.tsx.hbs**

SEO-optimized footer with link sections and social links.

```handlebars
import Link from 'next/link';
import { siteConfig } from '@/lib/site-config';

export function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="text-lg font-bold">
              {siteConfig.name}
            </Link>
            <p className="mt-2 text-sm text-muted-foreground">
              {siteConfig.description}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-3">Product</h3>
            <ul className="space-y-2">
              {siteConfig.footerLinks.product.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-3">Company</h3>
            <ul className="space-y-2">
              {siteConfig.footerLinks.company.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-3">Social</h3>
            <ul className="space-y-2">
              {Object.entries(siteConfig.social).map(([name, url]) => (
                <li key={name}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors capitalize"
                  >
                    {name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} {siteConfig.name}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/showcase/src/components/layout/
git commit -m "feat(showcase): add header and footer layout components"
```

---

## Task 5: Section Components

**Files:**
- Create: `apps/cli/templates/blueprints/showcase/src/components/sections/hero.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/components/sections/features.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/components/sections/social-proof.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/components/sections/faq.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/components/sections/cta.tsx.hbs`

- [ ] **Step 1: Create hero.tsx.hbs**

Outcome-focused hero with primary + secondary CTA.

```handlebars
import Link from 'next/link';
{{#if (isMono)}}
import { Button } from '@repo/ui/components/button';
{{else}}
import { Button } from '@/components/ui/button';
{{/if}}

export function Hero() {
  return (
    <section className="py-20 md:py-32">
      <div className="container mx-auto px-4 text-center">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-3xl mx-auto">
          Deliver messages at the speed of bird
        </h1>
        <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
          PigeonPost is the enterprise-grade carrier pigeon logistics platform.
          99.7% delivery rate. Zero digital footprint. No Wi-Fi required.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/contact">Start Your Flock</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/#features">See How It Works</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create features.tsx.hbs**

Features grid with benefit-focused copy (not feature-focused).

```handlebars
const features = [
  {
    title: 'Zero-Downtime Delivery',
    description:
      'Pigeons fly through storms, power outages, and DDoS attacks. When every other channel goes down, your messages still get through.',
  },
  {
    title: 'Real-Time Flock Tracking',
    description:
      'GPS-tagged pigeons with live dashboard. Track every message from loft to destination with sub-meter accuracy.',
  },
  {
    title: 'Air-Gapped Security',
    description:
      'No servers to breach. No packets to intercept. Messages travel on encrypted microfilm inside tamper-evident capsules.',
  },
  {
    title: 'Global Relay Network',
    description:
      'Pigeon relay stations across 47 countries. Long-distance messages are seamlessly handed off between trained flocks.',
  },
  {
    title: 'Automated Loft Integration',
    description:
      'Smart lofts with automated feeding, health monitoring, and message capsule loading. Plug into your existing infrastructure.',
  },
  {
    title: 'Enterprise SLA',
    description:
      'Dedicated flock, 24/7 avian support team, and guaranteed delivery windows. Because your board expects nothing less.',
  },
];

export function Features() {
  return (
    <section id="features" className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Why teams choose PigeonPost
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Built for organizations that demand reliability, security, and the gentle cooing of a well-trained homing pigeon.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-lg border bg-background p-6">
              <h3 className="text-lg font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create social-proof.tsx.hbs**

Logos + testimonials for trust signals.

```handlebars
const testimonials = [
  {
    quote: 'We switched from Slack to PigeonPost and our message delivery rate went from 99.1% to 99.7%. Plus, the office loves the pigeons.',
    author: 'Sarah Chen',
    role: 'VP of Operations',
    company: 'AcmeLogistics',
  },
  {
    quote: 'When our data center went down for 6 hours, PigeonPost was the only communication channel that kept working. The board was impressed.',
    author: 'Marcus Webb',
    role: 'CTO',
    company: 'SecureComm Inc.',
  },
  {
    quote: 'Our compliance team finally stopped worrying about message interception. Hard to hack a bird.',
    author: 'Priya Patel',
    role: 'Head of Security',
    company: 'FinanceFirst',
  },
];

const logos = ['AcmeLogistics', 'SecureComm', 'FinanceFirst', 'BirdWatch Global', 'NestCorp'];

export function SocialProof() {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <p className="text-center text-sm text-muted-foreground mb-8">
          Trusted by forward-thinking teams worldwide
        </p>
        <div className="flex flex-wrap justify-center gap-8 mb-16">
          {logos.map((logo) => (
            <span key={logo} className="text-muted-foreground/50 font-semibold text-lg">
              {logo}
            </span>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {testimonials.map((testimonial) => (
            <blockquote key={testimonial.author} className="rounded-lg border p-6">
              <p className="text-sm text-muted-foreground italic">
                &ldquo;{testimonial.quote}&rdquo;
              </p>
              <footer className="mt-4">
                <p className="text-sm font-semibold">{testimonial.author}</p>
                <p className="text-xs text-muted-foreground">
                  {testimonial.role}, {testimonial.company}
                </p>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create faq.tsx.hbs**

FAQ section with auto-injected FAQPage JSON-LD schema. Critical for GEO — AI engines cite FAQ content heavily.

```handlebars
import { FaqJsonLd } from '@/components/seo/json-ld';

const faqItems = [
  {
    question: 'How does PigeonPost actually work?',
    answer: 'You submit a message through our dashboard or API. The message is encrypted, printed on microfilm, and loaded into a tamper-evident capsule. A trained homing pigeon carries it to the destination loft, where it is scanned and delivered digitally to the recipient. Average delivery time: 2-4 hours for distances under 200 miles.',
  },
  {
    question: 'Is PigeonPost a joke?',
    answer: 'PigeonPost is a showcase template for create-faster, demonstrating a production-ready marketing site with SEO optimization, structured data, and conversion-focused design. The pigeon theme is intentionally absurd to make the template memorable and fun to customize.',
  },
  {
    question: 'What happens during bad weather?',
    answer: 'Our pigeons are trained in all weather conditions. For severe weather events, messages are automatically queued and dispatched via our indoor relay network. Enterprise plans include weather-contingency routing with guaranteed 4-hour delivery windows.',
  },
  {
    question: 'How secure is pigeon-based messaging?',
    answer: 'Extremely secure. Messages are AES-256 encrypted before printing on microfilm. The capsules are tamper-evident with GPS tracking. There is no digital transmission to intercept — the message physically travels through the air. This is true air-gapped communication.',
  },
  {
    question: 'Can I integrate PigeonPost with my existing tools?',
    answer: 'Yes. We offer REST API, webhooks, and native integrations with Slack, Teams, and major CRM platforms. Messages can be sent programmatically or through our dashboard.',
  },
];

export function Faq() {
  return (
    <section className="py-20 bg-muted/30">
      <FaqJsonLd items={faqItems} />
      <div className="container mx-auto px-4 max-w-3xl">
        <h2 className="text-3xl font-bold tracking-tight text-center mb-12">
          Frequently asked questions
        </h2>
        <div className="space-y-6">
          {faqItems.map((item) => (
            <details key={item.question} className="group rounded-lg border bg-background p-6">
              <summary className="cursor-pointer font-semibold list-none flex items-center justify-between">
                {item.question}
                <span className="ml-2 text-muted-foreground group-open:rotate-180 transition-transform">
                  &#9662;
                </span>
              </summary>
              <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create cta.tsx.hbs**

Final CTA section with value recap.

```handlebars
import Link from 'next/link';
{{#if (isMono)}}
import { Button } from '@repo/ui/components/button';
{{else}}
import { Button } from '@/components/ui/button';
{{/if}}

export function Cta() {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4 text-center">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          Ready to upgrade your communication infrastructure?
        </h2>
        <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
          Join hundreds of teams who trust carrier pigeons for their most critical messages. Free consultation included.
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/contact">Get Your Free Flock Assessment</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/showcase/src/components/sections/
git commit -m "feat(showcase): add hero, features, social proof, FAQ, and CTA sections"
```

---

## Task 6: Override Templates (layout, page, proxy, app-providers)

**Files:**
- Create: `apps/cli/templates/blueprints/showcase/src/app/layout.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/app/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/proxy.ts.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/components/app-providers.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/next-sitemap.config.js.hbs`

- [ ] **Step 1: Create layout.tsx.hbs (override)**

Replaces stack layout. Adds Organization + WebSite JSON-LD, PostHog pageview tracking, header/footer.

```handlebars
import type { Metadata } from 'next';
import '@/styles/globals.css';
import localFont from 'next/font/local';
import { PostHogPageView } from '@posthog/next';
import { Suspense } from 'react';
import { AppProviders } from '@/components/app-providers';
import { OrganizationJsonLd, WebSiteJsonLd } from '@/components/seo/json-ld';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { siteConfig } from '@/lib/site-config';
{{#if (hasLibrary "tanstack-devtools")}}
import { TanStackDevtools } from '@tanstack/react-devtools';
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools';
{{/if}}

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
    template: `%s | ${siteConfig.name}`,
    default: `${siteConfig.name} — ${siteConfig.description}`,
  },
  description: siteConfig.description,
  metadataBase: new URL(siteConfig.url),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
  },
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
          <OrganizationJsonLd />
          <WebSiteJsonLd />
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <Header />
          <main>{children}</main>
          <Footer />
          {{#if (hasLibrary "tanstack-devtools")}}
          {process.env.NODE_ENV === 'development' && (
            <TanStackDevtools
              config=\{{ position: 'top-left' }}
              eventBusConfig=\{{ connectToServerBus: true }}
              plugins={[{ name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> }]}
            />
          )}
          {{/if}}
        </AppProviders>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create app-providers.tsx.hbs (override)**

Adds `PostHogProvider` wrapping around existing provider chain.

```handlebars
'use client';

import { PostHogProvider } from '@posthog/next';
{{#if (and (hasLibrary "trpc") (hasLibrary "tanstack-query"))}}
import { TRPCReactProvider } from '@/trpc/providers';
{{else}}
{{#if (hasLibrary "tanstack-query")}}
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
{{/if}}
{{/if}}
{{#if (hasLibrary "next-themes")}}
import { ThemeProvider as NextThemesProvider } from 'next-themes';
{{/if}}
import type React from 'react';

{{#if (and (hasLibrary "tanstack-query") (ne (hasLibrary "trpc") true))}}
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
    },
  },
});
{{/if}}

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <PostHogProvider
      apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY!}
      clientOptions=\{{ api_host: '/ingest' }}
    >
    {{#if (and (hasLibrary "trpc") (hasLibrary "tanstack-query"))}}
    <TRPCReactProvider>
    {{else}}
    {{#if (hasLibrary "tanstack-query")}}
    <QueryClientProvider client={queryClient}>
    {{/if}}
    {{/if}}
    {{#if (hasLibrary "next-themes")}}
    <NextThemesProvider attribute='class' defaultTheme='system' enableSystem storageKey={"{{appName}}-theme"}>
    {{/if}}
    {children}
    {{#if (hasLibrary "next-themes")}}
    </NextThemesProvider>
    {{/if}}
    {{#if (and (hasLibrary "trpc") (hasLibrary "tanstack-query"))}}
    </TRPCReactProvider>
    {{else}}
    {{#if (hasLibrary "tanstack-query")}}
    </QueryClientProvider>
    {{/if}}
    {{/if}}
    </PostHogProvider>
  );
}
```

- [ ] **Step 3: Create proxy.ts.hbs (override)**

Composes PostHog proxy middleware into the existing proxy function pattern.

```handlebars
import { type NextRequest, NextResponse } from 'next/server';
import { postHogMiddleware } from '@posthog/next';

export default async function proxy(request: NextRequest) {
  const response = NextResponse.next();
  return postHogMiddleware({ proxy: true, response })(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
```

- [ ] **Step 4: Create page.tsx.hbs (override)**

Showcase homepage composing all section components.

```handlebars
import { Hero } from '@/components/sections/hero';
import { Features } from '@/components/sections/features';
import { SocialProof } from '@/components/sections/social-proof';
import { Faq } from '@/components/sections/faq';
import { Cta } from '@/components/sections/cta';

export default function HomePage() {
  return (
    <>
      <Hero />
      <SocialProof />
      <Features />
      <Faq />
      <Cta />
    </>
  );
}
```

- [ ] **Step 5: Create next-sitemap.config.js.hbs**

Root-level sitemap config. Needs frontmatter to place at project root, not inside `src/`.

```handlebars
---
path: next-sitemap.config.js
---
/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  generateRobotsTxt: true,
  changefreq: 'weekly',
  priority: 0.7,
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
  },
};
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/showcase/src/app/layout.tsx.hbs
git add apps/cli/templates/blueprints/showcase/src/app/page.tsx.hbs
git add apps/cli/templates/blueprints/showcase/src/proxy.ts.hbs
git add apps/cli/templates/blueprints/showcase/src/components/app-providers.tsx.hbs
git add apps/cli/templates/blueprints/showcase/next-sitemap.config.js.hbs
git commit -m "feat(showcase): add override templates for layout, page, proxy, providers, and sitemap config"
```

---

## Task 7: Content Pages (About, Contact, Blog, Personas)

**Files:**
- Create: `apps/cli/templates/blueprints/showcase/src/app/about/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/app/contact/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/app/blog/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/app/blog/[slug]/page.tsx.hbs`
- Create: `apps/cli/templates/blueprints/showcase/src/app/for/[persona]/page.tsx.hbs`

- [ ] **Step 1: Create about/page.tsx.hbs**

About page with E-E-A-T signals (expertise, trust, authority).

```handlebars
import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/seo/breadcrumbs';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'About',
  description: `Learn about ${siteConfig.name} — our mission, team, and why we believe carrier pigeons are the future of secure communication.`,
};

export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <Breadcrumbs items={[{ name: 'About', href: '/about' }]} />

      <h1 className="text-4xl font-bold tracking-tight">About {siteConfig.name}</h1>

      <section className="mt-8 space-y-4 text-muted-foreground leading-relaxed">
        <p>
          Founded in 2024, {siteConfig.name} was born from a simple observation:
          the most secure communication channel is one that never touches the internet.
        </p>
        <p>
          Our team of avian logistics experts and software engineers built a platform
          that combines centuries-old carrier pigeon technology with modern tracking,
          encryption, and fleet management software.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight">Our Mission</h2>
        <p className="mt-4 text-muted-foreground leading-relaxed">
          To provide every organization with communication infrastructure that is
          truly unhackable, always available, and surprisingly delightful. We believe
          the future of messaging has feathers.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight">The Team</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {[
            { name: 'Alex Featherstone', role: 'CEO & Chief Pigeon Officer' },
            { name: 'Jordan Wingfield', role: 'CTO' },
            { name: 'Morgan Coo', role: 'Head of Avian Operations' },
            { name: 'Casey Loft', role: 'VP of Engineering' },
          ].map((member) => (
            <div key={member.name} className="rounded-lg border p-4">
              <p className="font-semibold">{member.name}</p>
              <p className="text-sm text-muted-foreground">{member.role}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Create contact/page.tsx.hbs**

Simple contact form (no backend for now — static form with mailto or action placeholder).

```handlebars
import type { Metadata } from 'next';
{{#if (isMono)}}
import { Button } from '@repo/ui/components/button';
{{else}}
import { Button } from '@/components/ui/button';
{{/if}}
import { Breadcrumbs } from '@/components/seo/breadcrumbs';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with our team for a free flock assessment and consultation.',
};

export default function ContactPage() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-xl">
      <Breadcrumbs items={[{ name: 'Contact', href: '/contact' }]} />

      <h1 className="text-4xl font-bold tracking-tight">Get in touch</h1>
      <p className="mt-4 text-muted-foreground">
        Interested in upgrading your communication infrastructure? Fill out the form below and
        we will send a pigeon with our response.
      </p>

      <form className="mt-8 space-y-6" action="#" method="POST">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-2">Name</label>
          <input
            type="text"
            id="name"
            name="name"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Your name"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-2">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="you@company.com"
          />
        </div>
        <div>
          <label htmlFor="message" className="block text-sm font-medium mb-2">Message</label>
          <textarea
            id="message"
            name="message"
            required
            rows={5}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
            placeholder="Tell us about your messaging needs..."
          />
        </div>
        <Button type="submit" size="lg" className="w-full">
          Send Message
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Create blog/page.tsx.hbs**

Blog index listing all MDX posts with metadata. SEO-optimized with proper heading hierarchy.

```handlebars
import type { Metadata } from 'next';
import Link from 'next/link';
import { getAllPosts } from '@/lib/blog';
import { Breadcrumbs } from '@/components/seo/breadcrumbs';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Blog',
  description: `Articles and insights from the ${siteConfig.name} team on carrier pigeon logistics, secure messaging, and avian technology.`,
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <Breadcrumbs items={[{ name: 'Blog', href: '/blog' }]} />

      <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
      <p className="mt-4 text-muted-foreground">
        Insights on carrier pigeon logistics, secure messaging, and the future of avian communication.
      </p>

      <div className="mt-12 space-y-8">
        {posts.map((post) => (
          <article key={post.slug} className="group">
            <Link href={`/blog/${post.slug}`} className="block rounded-lg border p-6 hover:border-foreground/20 transition-colors">
              <time dateTime={post.publishedAt} className="text-sm text-muted-foreground">
                {new Date(post.publishedAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </time>
              <h2 className="mt-2 text-xl font-semibold group-hover:text-primary transition-colors">
                {post.title}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                {post.summary}
              </p>
            </Link>
          </article>
        ))}
      </div>

      {posts.length === 0 && (
        <p className="mt-12 text-muted-foreground text-center">No articles yet. Check back soon.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create blog/[slug]/page.tsx.hbs**

Individual blog article with MDX rendering, Article JSON-LD, and breadcrumbs.

```handlebars
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { mdxComponents } from '@/mdx-components';
import { getAllPosts, getPost } from '@/lib/blog';
import { Breadcrumbs } from '@/components/seo/breadcrumbs';
import { ArticleJsonLd } from '@/components/seo/json-ld';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const post = getPost(slug);

  if (!post) return {};

  return {
    title: post.metadata.title,
    description: post.metadata.summary,
    openGraph: {
      title: post.metadata.title,
      description: post.metadata.summary,
      type: 'article',
      publishedTime: post.metadata.publishedAt,
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPost(slug);

  if (!post) notFound();

  return (
    <article className="container mx-auto px-4 py-12 max-w-3xl">
      <ArticleJsonLd
        title={post.metadata.title}
        description={post.metadata.summary}
        publishedAt={post.metadata.publishedAt}
        url={`/blog/${slug}`}
        imageUrl={post.metadata.imageUrl}
      />

      <Breadcrumbs
        items={[
          { name: 'Blog', href: '/blog' },
          { name: post.metadata.title, href: `/blog/${slug}` },
        ]}
      />

      <header className="mb-8">
        <time dateTime={post.metadata.publishedAt} className="text-sm text-muted-foreground">
          {new Date(post.metadata.publishedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </time>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">{post.metadata.title}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{post.metadata.summary}</p>
      </header>

      <MDXRemote source={post.content} components={mdxComponents} />
    </article>
  );
}
```

- [ ] **Step 5: Create for/[persona]/page.tsx.hbs**

Programmatic persona pages with unique content per persona. Each page has its own FAQ + JSON-LD.

```handlebars
import { notFound } from 'next/navigation';
import Link from 'next/link';
{{#if (isMono)}}
import { Button } from '@repo/ui/components/button';
{{else}}
import { Button } from '@/components/ui/button';
{{/if}}
import { getPersona, getAllPersonaSlugs } from '@/lib/personas';
import { Breadcrumbs } from '@/components/seo/breadcrumbs';
import { FaqJsonLd } from '@/components/seo/json-ld';

interface PageProps {
  params: Promise<{ persona: string }>;
}

export function generateStaticParams() {
  return getAllPersonaSlugs().map((persona) => ({ persona }));
}

export async function generateMetadata({ params }: PageProps) {
  const { persona: slug } = await params;
  const persona = getPersona(slug);

  if (!persona) return {};

  return {
    title: persona.title,
    description: persona.description,
  };
}

export default async function PersonaPage({ params }: PageProps) {
  const { persona: slug } = await params;
  const persona = getPersona(slug);

  if (!persona) notFound();

  return (
    <div className="container mx-auto px-4 py-12">
      <Breadcrumbs items={[{ name: persona.title, href: `/for/${slug}` }]} />

      <section className="text-center max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{persona.headline}</h1>
        <p className="mt-6 text-lg text-muted-foreground">{persona.description}</p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/contact">Get Started</Link>
          </Button>
        </div>
      </section>

      <section className="mt-20 grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
        {persona.benefits.map((benefit) => (
          <div key={benefit.title} className="rounded-lg border p-6">
            <h2 className="text-lg font-semibold">{benefit.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{benefit.description}</p>
          </div>
        ))}
      </section>

      {persona.faq.length > 0 && (
        <section className="mt-20 max-w-3xl mx-auto">
          <FaqJsonLd items={persona.faq} />
          <h2 className="text-2xl font-bold tracking-tight text-center mb-8">
            Frequently asked questions
          </h2>
          <div className="space-y-4">
            {persona.faq.map((item) => (
              <details key={item.question} className="group rounded-lg border bg-background p-6">
                <summary className="cursor-pointer font-semibold list-none flex items-center justify-between">
                  {item.question}
                  <span className="ml-2 text-muted-foreground group-open:rotate-180 transition-transform">
                    &#9662;
                  </span>
                </summary>
                <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/showcase/src/app/about/
git add apps/cli/templates/blueprints/showcase/src/app/contact/
git add apps/cli/templates/blueprints/showcase/src/app/blog/
git add apps/cli/templates/blueprints/showcase/src/app/for/
git commit -m "feat(showcase): add about, contact, blog, and persona pages"
```

---

## Task 8: Blog Content (Example MDX Articles)

**Files:**
- Create: `apps/cli/templates/blueprints/showcase/contents/blog/getting-started-with-pigeon-logistics.mdx`
- Create: `apps/cli/templates/blueprints/showcase/contents/blog/why-carrier-pigeons-beat-email.mdx`

- [ ] **Step 1: Create first blog article**

```mdx
---
title: Getting Started with Pigeon Logistics
summary: A practical guide to setting up your first carrier pigeon delivery network, from loft construction to route planning.
publishedAt: 2025-01-15
---

# Getting Started with Pigeon Logistics

Setting up a carrier pigeon logistics network is easier than you think. This guide walks you through everything from choosing your first flock to planning delivery routes.

## Step 1: Choose Your Breed

Not all pigeons are created equal. For enterprise logistics, we recommend:

- **Racing Homers** — Fast, reliable, and bred for long-distance navigation
- **English Carriers** — Larger payload capacity, ideal for document delivery
- **Dragoon pigeons** — Excellent in urban environments with complex routing

## Step 2: Build Your Loft

A well-designed loft is the foundation of your logistics network. Key considerations:

- **Location**: High ground with clear sightlines in the departure direction
- **Ventilation**: Pigeons perform best at 50-70°F with good airflow
- **Landing platform**: Minimum 6ft wide with automated capsule unloading

## Step 3: Plan Your Routes

Start with short routes (under 50 miles) and gradually extend:

1. Map your most critical communication paths
2. Identify relay stations for distances over 200 miles
3. Set up weather monitoring at each station
4. Train your pigeons on each route segment individually

## What's Next?

Once your basic network is operational, you can integrate PigeonPost's tracking dashboard for real-time flight monitoring and delivery confirmation.
```

- [ ] **Step 2: Create second blog article**

```mdx
---
title: Why Carrier Pigeons Beat Email for Secure Communication
summary: An analysis of why physical message delivery via carrier pigeon offers security guarantees that no digital communication channel can match.
publishedAt: 2025-02-20
---

# Why Carrier Pigeons Beat Email for Secure Communication

In an era of sophisticated cyber attacks, data breaches, and state-sponsored surveillance, the most secure communication channel might be the oldest one.

## The Problem with Digital Communication

Every digital message creates a trail:

- **Email**: Stored on multiple servers, metadata is always visible
- **Encrypted messaging**: Endpoints can be compromised, metadata still leaks
- **VPNs**: Traffic analysis can reveal communication patterns

## The Pigeon Advantage

Carrier pigeons offer something no digital channel can: **true air-gapping**.

### No Digital Footprint

A pigeon carrying an encrypted microfilm capsule leaves no server logs, no packet traces, and no metadata. The message exists only in physical form during transit.

### Tamper Evidence

Our capsules are designed with tamper-evident seals. If a message is intercepted, both sender and receiver know immediately. Try getting that guarantee from your email provider.

### Physics-Based Security

To intercept a pigeon, an attacker must:

1. Know the exact flight path (randomized per delivery)
2. Physically catch a bird flying at 60mph
3. Crack the capsule seal without detection
4. Decrypt the AES-256 encrypted microfilm

The attack surface is, quite literally, the entire sky.

## When Digital Still Wins

To be fair, pigeons are not ideal for everything. Real-time chat, video calls, and sending cat GIFs are still better done digitally. But for high-stakes, asynchronous communication where security is paramount? Send a bird.
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/templates/blueprints/showcase/contents/
git commit -m "feat(showcase): add example blog articles"
```

---

## Task 9: Test

- [ ] **Step 1: Verify TypeScript compilation**

```bash
cd apps/cli && bunx tsc --noEmit
```

Expected: No errors

- [ ] **Step 2: Test single repo mode**

```bash
cd /tmp && bunx /home/ttecim/.lab/create-faster-br/apps/cli/src/index.ts test-showcase-single --blueprint showcase --linter biome --git --pm bun
```

- [ ] **Step 3: Verify generated files**

Check that these files exist in the generated project:
- `next-sitemap.config.js` (from blueprint, at root)
- `src/proxy.ts` (override, has PostHog)
- `src/app/page.tsx` (override, has sections)
- `src/app/layout.tsx` (override, has PostHog + JSON-LD)
- `src/app/about/page.tsx` (addition)
- `src/app/contact/page.tsx` (addition)
- `src/app/blog/page.tsx` (addition)
- `src/app/blog/[slug]/page.tsx` (addition)
- `src/app/for/[persona]/page.tsx` (addition)
- `src/components/seo/json-ld.tsx` (addition)
- `src/components/seo/breadcrumbs.tsx` (addition)
- `src/components/sections/hero.tsx` (addition)
- `src/components/layout/header.tsx` (addition)
- `src/lib/site-config.ts` (addition)
- `src/lib/personas.ts` (addition)
- `src/lib/blog.ts` (addition)
- `contents/blog/*.mdx` (addition)
- `package.json` has `@posthog/next` and `next-sitemap`
- `.env.example` has `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_SITE_URL`

- [ ] **Step 4: Test install and dev**

```bash
cd /tmp/test-showcase-single && bun install && bun run dev
```

Expected: Dev server starts, homepage renders with hero/features/FAQ sections.

- [ ] **Step 5: Test interactive mode**

```bash
cd /tmp && bunx /home/ttecim/.lab/create-faster-br/apps/cli/src/index.ts
```

Expected: "Showcase" appears in blueprint list under "Business" category.

- [ ] **Step 6: Commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix(showcase): address test issues"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | META entry | 1 modified |
| 2 | Site config + data layer | 3 created |
| 3 | SEO components (JSON-LD, breadcrumbs) | 2 created |
| 4 | Layout components (header, footer) | 2 created |
| 5 | Section components (hero, features, social proof, FAQ, CTA) | 5 created |
| 6 | Override templates (layout, page, proxy, providers, sitemap) | 5 created |
| 7 | Content pages (about, contact, blog, personas) | 5 created |
| 8 | Example MDX articles | 2 created |
| 9 | Testing | 0 (verification only) |

**Total: 1 modified, 24 created**
