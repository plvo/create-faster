import { join } from 'node:path';

const WAIT_TIMEOUT_MS = 10_000;

export const ENTER = '\r';
export const SPACE = ' ';

export interface Keystroke {
  /** Text the prompt must have printed since the previous keystroke; any new output when omitted. */
  after?: string;
  send: string;
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('the prompt did not print what the test waits for');
    await Bun.sleep(10);
  }
}

/** Runs a script of `apps/cli` on a pseudo-terminal, sending each key once the prompt has printed what precedes it. */
export async function runOnPseudoTerminal(script: string, keystrokes: Keystroke[]): Promise<string> {
  let output = '';
  const process = Bun.spawn(['bun', '-e', script], {
    cwd: join(import.meta.dir, '../../..'),
    terminal: {
      cols: 100,
      rows: 30,
      data: (_terminal, chunk) => {
        output += new TextDecoder().decode(chunk);
      },
    },
  });

  try {
    let printedBefore = 0;
    for (const { after, send } of keystrokes) {
      await waitFor(() => (after ? output.slice(printedBefore).includes(after) : output.length > printedBefore));
      printedBefore = output.length;
      process.terminal?.write(send);
    }
    await process.exited;
  } finally {
    process.kill();
  }
  return output;
}
