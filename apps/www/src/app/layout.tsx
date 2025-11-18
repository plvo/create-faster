import { RootProvider } from 'fumadocs-ui/provider/next';
import '@/styles/global.css';
import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/lib/constants';

const inter = Inter({
  subsets: ['latin'],
});

const bluunext = localFont({
  src: '../styles/fonts/bluunext-bold.otf',
  variable: '--font-bluunext',
  weight: '100 900',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s - ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'create-faster',
    'cli tool',
    'scaffolding',
    'next.js',
    'react',
    'tanstack',
    'expo',
    'hono',
    'prisma',
    'drizzle',
    'typescript',
    'javascript',
    'full-stack',
    'monorepo',
    'turborepo',
    'shadcn',
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    images: [
      {
        url: '/og-default.png',
        width: 1200,
        height: 630,
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/og-default.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    shortcut: '/cf-96x96.png',
    apple: '/apple-icon.png',
    icon: [
      {
        rel: 'icon',
        media: '(prefers-color-scheme: light)',
        url: '/favicon-light.ico',
      },
      {
        rel: 'icon',
        media: '(prefers-color-scheme: dark)',
        url: '/favicon-dark.ico',
      },
    ],
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  // Structured Data for Organization
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/docs?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <html lang='en' className={`${inter.className} ${bluunext.variable}`} suppressHydrationWarning>
      <head>
        <meta name='apple-mobile-web-app-title' content='Create Faster' />
        {/** biome-ignore lint/security/noDangerouslySetInnerHtml: seo */}
        <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body className='flex flex-col min-h-screen'>
        <RootProvider>{children}</RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
