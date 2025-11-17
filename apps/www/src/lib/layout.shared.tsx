import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className='flex items-center gap-0.5'>
          <Image src='/cf-light.png' alt='Create Faster' width={64} height={64} className='size-7 dark:hidden' />
          <Image src='/cf-dark.png' alt='Create Faster' width={64} height={64} className='size-7 hidden dark:block' />
          <span className='font-bold font-bluunext'>Create Faster</span>
        </div>
      ),
    },
    githubUrl: 'https://github.com/plvo/create-faster',
    searchToggle: {
      enabled: true,
    },
    themeSwitch: {
      enabled: true,
      mode: 'light-dark',
    },
    links: [
      {
        text: 'Documentation',
        url: '/docs',
        on: 'nav',
        active: 'none',
      },
      {
        type: 'icon',
        text: 'NPM',
        label: 'NPM',
        url: 'https://www.npmjs.com/package/create-faster',
        icon: (
          <svg role='img' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
            <title aria-label='NPM'>npm</title>
            <path
              d='M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z'
              fill='currentColor'
            />
          </svg>
        ),
      },
      {
        type: 'icon',
        text: 'X',
        label: 'X',
        url: 'https://x.com/pelavo7',
        icon: (
          <svg xmlns='http://www.w3.org/2000/svg' role='img' viewBox='0 0 24 24'>
            <title aria-label='X'>X</title>
            <path
              d='M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z'
              fill='currentColor'
            />
          </svg>
        ),
      },
    ],
  };
}
