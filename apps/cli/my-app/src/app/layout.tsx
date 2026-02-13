import type { Metadata } from 'next';
import '@/styles/globals.css';
import localFont from 'next/font/local';

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
    template: '%s | my-app',
    default: 'Home | my-app',
  },
  description: 'my-app - Initialized with https://github.com/plvo/create-faster',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        <main>{children}</main>
      </body>
    </html>
  );
}
