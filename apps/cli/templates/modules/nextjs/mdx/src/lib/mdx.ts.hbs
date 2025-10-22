export type MdxFrontmatter = {
  title: string;
  summary: string;
  publishedAt: string;
  imageUrl?: string;
};

export type ParsedFrontmatterReturn = {
  metadata: Partial<MdxFrontmatter>;
  content: string;
};

// https://github.com/shadcn/leerob.io/blob/main/app/db/blog.ts#L58
export function parseFrontmatter(fileContent: string): ParsedFrontmatterReturn {
  const frontmatterRegex = /---\s*([\s\S]*?)\s*---/;
  const match = frontmatterRegex.exec(fileContent);
  // biome-ignore lint/style/noNonNullAssertion: ok
  const frontMatterBlock = match![1];
  const content = fileContent.replace(frontmatterRegex, '').trim();
  const frontMatterLines = frontMatterBlock.trim().split('\n');
  const metadata: Partial<MdxFrontmatter> = {};

  frontMatterLines.forEach((line) => {
    const [key, ...valueArr] = line.split(': ');
    let value = valueArr.join(': ').trim();
    value = value.replace(/^['"](.*)['"]$/, '$1'); // Remove quotes
    metadata[key.trim() as keyof MdxFrontmatter] = value;
  });

  return { metadata, content };
}
