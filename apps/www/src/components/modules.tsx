import Link from 'next/link';

type ModuleMeta = { label: string; category: string; href: string };

const MODULE_META: Record<string, ModuleMeta> = {
  shadcn: { label: 'shadcn/ui', category: 'UI', href: '/docs/modules/ui/shadcn' },
  'next-themes': { label: 'Next Themes', category: 'UI', href: '/docs/modules/ui/next-themes' },
  nativewind: { label: 'NativeWind', category: 'UI', href: '/docs/modules/ui/nativewind' },
  mdx: { label: 'MDX', category: 'Content', href: '/docs/modules/content/mdx' },
  pwa: { label: 'PWA', category: 'Content', href: '/docs/modules/content/pwa' },
  'better-auth': { label: 'Better Auth', category: 'Auth', href: '/docs/modules/auth/better-auth' },
  trpc: { label: 'tRPC', category: 'API', href: '/docs/modules/api/trpc' },
  'tanstack-query': {
    label: 'TanStack Query',
    category: 'Data Fetching',
    href: '/docs/modules/data-fetching/tanstack-query',
  },
  'tanstack-devtools': {
    label: 'TanStack Devtools',
    category: 'Data Fetching',
    href: '/docs/modules/data-fetching/tanstack-devtools',
  },
  'react-hook-form': { label: 'React Hook Form', category: 'Forms', href: '/docs/modules/forms/react-hook-form' },
  'tanstack-form': { label: 'TanStack Form', category: 'Forms', href: '/docs/modules/forms/tanstack-form' },
  'aws-lambda': { label: 'AWS Lambda', category: 'Deploy', href: '/docs/modules/deploy/aws-lambda' },
};

export function Modules({ names }: { names: string }) {
  const ids = names.split(',').map((s) => s.trim());
  const modules = ids.map((id) => MODULE_META[id]).filter(Boolean);

  const grouped = Map.groupBy(modules, (m) => m.category);

  return (
    <div className='not-prose my-4 space-y-3'>
      {[...grouped.entries()].map(([category, items]) => (
        <div key={category}>
          <span className='text-xs font-medium text-fd-muted-foreground mb-1.5 block'>{category}</span>
          <div className='flex flex-wrap gap-1.5'>
            {items.map((mod) => (
              <Link
                key={mod.href}
                href={mod.href}
                className='inline-flex items-center gap-1.5 rounded-md border border-fd-border bg-fd-secondary/50 px-2.5 py-1 text-xs font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground hover:border-fd-ring'
              >
                {mod.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
