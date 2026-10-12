import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './helpers';

const PROBE_FILE = 'siwe-probe.mjs';

export interface SiweAttempt {
  status: number;
  body: { code?: string; user?: { id: string } };
  sessionCookie: string;
}

// Runs inside the generated project, so it signs with the project's own viem, like the browser does.
// The nonce comes from the server, the message is built for `domain` and signed with a throwaway key.
const probeScript = `import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

const [appUrl, domain] = process.argv.slice(2);
const account = privateKeyToAccount(generatePrivateKey());
const post = (path, body) =>
  fetch(new URL(path, appUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: appUrl },
    body: JSON.stringify(body),
  });

const { nonce } = await (await post('/api/auth/siwe/nonce', {})).json();
const message = createSiweMessage({
  domain,
  address: account.address,
  statement: 'Sign in with Ethereum.',
  uri: appUrl,
  version: '1',
  chainId: 1,
  nonce,
});
const signature = await account.signMessage({ message });
const response = await post('/api/auth/siwe/verify', { message, signature });
const sessionCookie = response.headers
  .getSetCookie()
  .map((cookie) => cookie.split(';')[0])
  .join('; ');
console.log(JSON.stringify({ status: response.status, body: await response.json(), sessionCookie }));
`;

/** Signs in with a fresh wallet through the SIWE endpoints, with a message that names `domain`. */
export async function signInWithEthereum(projectDir: string, appUrl: string, domain: string): Promise<SiweAttempt> {
  await writeFile(join(projectDir, PROBE_FILE), probeScript);
  const result = await runCommand(['bun', 'run', PROBE_FILE, appUrl, domain], projectDir);
  if (result.exitCode !== 0) throw new Error(`SIWE probe failed:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as SiweAttempt;
}
