import fs from 'node:fs';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { parseFrontmatter } from '@/lib/mdx';
import { mdxComponents } from '@/mdx-components';

interface PageProps {
  params: Promise<{ mdxExampleSlug: string[] }>;
}

export const generateMetadata = async ({ params }: PageProps) => {
  const { mdxExampleSlug } = await params;

  if (mdxExampleSlug === undefined) {
    return undefined;
  }

  const fileContent = getFileContent(mdxExampleSlug);

  if (fileContent === null) {
    return notFound();
  }

  const { metadata } = parseFrontmatter(fileContent);

  return {
    title: metadata.title,
    description: metadata.summary,
  };
};

export default async function Page({ params }: PageProps) {
  const { mdxExampleSlug } = await params;

  const fileContent = getFileContent(mdxExampleSlug);

  if (fileContent === null) {
    return notFound();
  }

  const { metadata, content: mdxContent } = parseFrontmatter(fileContent);

  return (
    <main className='max-w-[650px] mx-auto px-4 py-4 md:py-8'>
      <MDXRemote source={mdxContent} components={mdxComponents} />
      <pre>
        <code>{JSON.stringify({ metadata }, null, 2)}</code>
      </pre>
    </main>
  );
}

function getFileContent(slug: string[]): string | null {
  const contentPath = getContentPath(slug);

  if (!fs.existsSync(contentPath)) {
    return null;
  }
  return fs.readFileSync(contentPath, 'utf-8');
}

function getContentPath(slug: string[]) {
  if (slug === undefined) {
    return path.join(process.cwd(), 'contents', 'home.mdx');
  } else {
    const [name] = slug;
    return path.join(process.cwd(), 'contents', `${name}.mdx`);
  }
}
