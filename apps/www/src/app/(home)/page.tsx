import { Book } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { CliDemo } from '@/components/cli-demo';

export default function HomePage() {
  return (
    <main className='flex flex-col justify-center text-center flex-1 gap-6'>
      <div className='space-y-2'>
        <div className='flex items-center justify-center'>
          <Image
            src='/cf-light.png'
            alt='Create Faster'
            width={1024}
            height={1024}
            className='size-14 block dark:hidden'
          />
          <Image
            src='/cf-dark.png'
            alt='Create Faster'
            width={1024}
            height={1024}
            className='size-14 hidden dark:block'
          />

          <h1 className='text-4xl font-bold font-bluunext'>Create Faster</h1>
        </div>
        <p className='text-lg text-fd-muted-foreground max-w-3xl mx-auto'>
          Initialize production-ready full-stack projects with multiple framework combinations
        </p>
      </div>

      <div
        className='w-full max-w-5xl border border-fd-accent rounded-xl mx-auto overflow-hidden
          shadow-[0_0_32px_0_rgba(0,48,255,0.1),0_0_16px_0_rgba(0,48,255,0.08)]'
      >
        <CliDemo />
      </div>

      <div className='flex max-md:flex-col items-center justify-center gap-2'>
        <Link href='https://github.com/plvo/create-faster' target='_blank'>
          <button
            type='button'
            className='px-4 py-2 rounded-md bg-fd-accent text-fd-accent-foreground cursor-pointer flex items-center gap-2 hover:bg-fd-accent/90'
          >
            <svg
              role='img'
              viewBox='0 0 24 24'
              xmlns='http://www.w3.org/2000/svg'
              className='size-4'
              fill='currentColor'
            >
              <title>GitHub</title>
              <path d='M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' />
            </svg>
            GitHub
          </button>
        </Link>
        <Link href='/docs'>
          <button
            type='button'
            className='px-4 py-2 rounded-md bg-fd-accent text-fd-accent-foreground cursor-pointer flex items-center gap-2 hover:bg-fd-accent/90'
          >
            <Book className='size-4' />
            Documentation
          </button>
        </Link>
      </div>
    </main>
  );
}
