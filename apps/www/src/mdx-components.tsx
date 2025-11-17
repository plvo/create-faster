import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { ChangelogContent } from './components/changelog-content';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
    h1: ({ ...props }: React.ComponentPropsWithoutRef<'h1'>) => <h1 className='font-bluunext' {...props} />,
    h2: ({ ...props }: React.ComponentPropsWithoutRef<'h2'>) => <h2 className='font-bluunext' {...props} />,
    ChangelogContent,
  };
}
