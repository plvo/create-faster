import fs from 'node:fs';
import path from 'node:path';
import { generate as DefaultImage } from 'fumadocs-ui/og';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { SITE_URL } from '@/lib/constants';
import { getPageImage, source } from '@/lib/source';

const bluunextFont = fs.readFileSync(path.join(process.cwd(), 'src/styles/fonts/bluunext-bold.otf'));

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const { title, description } = page.data;

  const truncatedDescription =
    description && description.length > 120 ? `${description.slice(0, 120)}...` : description;

  return new ImageResponse(
    <DefaultImage
      site='create-faster'
      title={<span style={{ color: 'rgb(5, 105, 255)' }}>{title}</span>}
      description={truncatedDescription}
      icon={<img src={`${SITE_URL}/cf-dark.png`} alt='Create Faster' width={64} height={64} />}
      primaryColor='rgba(5, 105, 255, 0.15)'
      primaryTextColor='white'
    />,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Bluunext',
          data: bluunextFont,
          style: 'normal',
        },
      ],
    },
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }));
}
