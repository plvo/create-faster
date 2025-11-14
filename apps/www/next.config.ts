import { createMDX } from 'fumadocs-mdx/next';
import type { NextConfig } from 'next';

const withMDX = createMDX();

const config: NextConfig = {
  reactStrictMode: true,

  compiler: {
    removeConsole: true,
  },
};

export default withMDX(config);
