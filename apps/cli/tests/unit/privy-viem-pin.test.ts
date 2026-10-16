import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

// viem version each pinned Privy release requires, from the registry:
// `npm view @privy-io/react-auth@<v> dependencies.viem`, `npm view @privy-io/wagmi@<v> peerDependencies.viem`.
// Update an entry from the registry together with the version it describes.
const VIEM_REQUIRED_BY_REACT_AUTH: Record<string, string> = {
  '3.49.0': '2.57.5',
};

const VIEM_REQUIRED_BY_PRIVY_WAGMI: Record<string, string> = {
  '4.0.19': '2.57.5',
};

function pinnedVersionOf(dependency: string): string {
  const version = META.blueprints['dapp-privy-nextjs']?.packageJson?.dependencies?.[dependency];
  if (typeof version !== 'string') throw new Error(`dapp-privy-nextjs declares no ${dependency} version`);
  return version;
}

describe('dapp-privy-nextjs dependency set resolves under npm', () => {
  const reactAuth = pinnedVersionOf('@privy-io/react-auth');
  const privyWagmi = pinnedVersionOf('@privy-io/wagmi');
  const viem = pinnedVersionOf('viem');

  test('the pinned @privy-io/react-auth release has a recorded viem requirement', () => {
    expect(VIEM_REQUIRED_BY_REACT_AUTH[reactAuth], `record the viem that @privy-io/react-auth@${reactAuth} depends on`).toBeDefined();
  });

  test('the pinned @privy-io/wagmi release has a recorded viem requirement', () => {
    expect(VIEM_REQUIRED_BY_PRIVY_WAGMI[privyWagmi], `record the viem that @privy-io/wagmi@${privyWagmi} peers on`).toBeDefined();
  });

  test('viem is the exact version both Privy packages require', () => {
    expect<string | undefined>(viem).toBe(VIEM_REQUIRED_BY_REACT_AUTH[reactAuth]);
    expect<string | undefined>(viem).toBe(VIEM_REQUIRED_BY_PRIVY_WAGMI[privyWagmi]);
  });
});
