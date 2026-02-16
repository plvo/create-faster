import { MDXRemote } from 'next-mdx-remote/rsc';

interface GitHubChangelogProps {
  owner?: string;
  repo?: string;
  path?: string;
}

export async function ChangelogContent({
  owner = 'plvo',
  repo = 'create-faster',
  path = 'apps/cli/CHANGELOG.md',
}: GitHubChangelogProps = {}) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;

  try {
    const response = await fetch(url, {
      next: {
        revalidate: false,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch changelog: ${response.statusText}`);
    }

    const markdown = await response.text();

    return <MDXRemote source={markdown.split('Changelog')[1]} />;
  } catch {
    return (
      <div className='rounded-lg border border-red-500/20 bg-red-500/10 p-4'>
        <p className='text-sm text-red-500'>
          Failed to load changelog from GitHub.{' '}
          <a
            href={`https://github.com/${owner}/${repo}/blob/main/${path}`}
            target='_blank'
            rel='noopener noreferrer'
            className='underline'
          >
            View on GitHub
          </a>
        </p>
      </div>
    );
  }
}
