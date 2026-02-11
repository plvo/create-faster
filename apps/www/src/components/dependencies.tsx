import Link from 'next/link';

function Badge({ name, dev }: { name: string; dev?: boolean }) {
  return (
    <Link
      href={`https://www.npmjs.com/package/${name}`}
      target='_blank'
      rel='noopener noreferrer'
      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-mono transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground hover:border-fd-ring ${
        dev
          ? 'border-fd-border/50 bg-fd-muted/30 text-fd-muted-foreground'
          : 'border-fd-border bg-fd-secondary/50 text-fd-secondary-foreground'
      }`}
    >
      {name}
      {dev && <span className='ml-1.5 text-[10px] opacity-60'>dev</span>}
    </Link>
  );
}

export function Dependencies({ packages, dev }: { packages?: string; dev?: string }) {
  const deps = packages
    ? packages
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const devDeps = dev
    ? dev
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (deps.length === 0 && devDeps.length === 0) return null;

  return (
    <div className='not-prose flex flex-wrap gap-1.5 my-3'>
      {deps.map((name) => (
        <Badge key={name} name={name} />
      ))}
      {devDeps.map((name) => (
        <Badge key={name} name={name} dev />
      ))}
    </div>
  );
}
