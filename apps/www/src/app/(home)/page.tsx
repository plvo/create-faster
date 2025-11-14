'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from 'next-themes';

export default function HomePage() {
  const { theme } = useTheme();
  return (
    <main className='flex flex-col justify-center text-center flex-1'>
      <div className='flex flex-col items-center justify-center'>
        <Image
          src={theme === 'light' ? '/cf-black.png' : '/cf-white.png'}
          alt='Create Faster'
          width={1024}
          height={1024}
          className='size-64'
        />
        <h1 className='text-4xl font-bold'>Create Faster</h1>
        <p className='text-lg text-fd-muted-foreground max-w-2xl mt-4'>
          A modern CLI scaffolding tool that generates production-ready full-stack projects with multiple framework
          combinations.
        </p>
      </div>

      <Link href='/docs' className='mt-4'>
        <button
          type='button'
          className='mt-4 px-4 py-2 rounded-md bg-fd-accent text-fd-accent-foreground cursor-pointer'
        >
          Documentation
        </button>
      </Link>
    </main>
  );
}
