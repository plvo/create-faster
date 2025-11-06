import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'create-faster',
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
        text: 'NPM',
        url: 'https://www.npmjs.com/package/create-faster',
      },
      {
        text: 'X',
        url: 'https://x.com/pelavo7',
      },
    ],
  };
}
