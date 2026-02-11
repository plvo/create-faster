import Link from 'next/link';

const STACK_META: Record<string, { label: string; href: string }> = {
  nextjs: { label: 'Next.js', href: '/docs/stacks/nextjs' },
  expo: { label: 'Expo', href: '/docs/stacks/expo' },
  'tanstack-start': { label: 'TanStack Start', href: '/docs/stacks/tanstack-start' },
  hono: { label: 'Hono', href: '/docs/stacks/hono' },
  all: { label: 'All Stacks', href: '/docs' },
};

export function Stacks({ names }: { names: string }) {
  const stacks = names.split(',').map((s) => s.trim());

  return (
    <div className='not-prose flex flex-wrap gap-1.5 my-3'>
      {stacks.map((id) => {
        const meta = STACK_META[id];
        if (!meta) return null;

        return (
          <Link
            key={id}
            href={meta.href}
            className='inline-flex items-center gap-1.5 rounded-md border border-fd-border bg-fd-secondary/50 px-2.5 py-1 text-xs font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground hover:border-fd-ring'
          >
            {meta.label}
          </Link>
        );
      })}
    </div>
  );
}
