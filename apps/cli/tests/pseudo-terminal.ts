import { join } from 'node:path';
import { PLAIN_OUTPUT_ENV } from './plain-output-env';

export const ENTER = '\r';
export const SPACE = ' ';
export const DOWN = '\x1b[B';
export const CTRL_C = '\x03';

const APP_CLI_DIR = join(import.meta.dir, '..');
const KEY_DELAY_MS = 100;
const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface Keystroke {
  /** Text the program must have printed since the previous keystroke; any new output when omitted. */
  prompt?: string;
  keys: string;
}

interface TerminalRun {
  exitCode: number;
  output: string;
}

/** Runs a command on a pseudo-terminal, sending each keystroke once the program has printed what precedes it. */
export async function runOnPseudoTerminal(
  command: string[],
  cwd: string,
  keystrokes: Keystroke[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TerminalRun> {
  let output = '';

  const proc = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...PLAIN_OUTPUT_ENV },
    terminal: {
      cols: 120,
      rows: 40,
      data: (_terminal, chunk) => {
        output += new TextDecoder().decode(chunk);
      },
    },
  });

  const deadline = Date.now() + timeoutMs;
  const timeoutMessage = (waitingFor: string) =>
    `"${command.join(' ')}" did not ${waitingFor} within ${timeoutMs} ms. Output:\n${output}`;

  try {
    let searchFrom = 0;
    for (const { prompt, keys } of keystrokes) {
      const hasPrinted = () => (prompt ? output.indexOf(prompt, searchFrom) !== -1 : output.length > searchFrom);
      while (!hasPrinted()) {
        if (Date.now() > deadline) throw new Error(timeoutMessage(`print ${prompt ? `"${prompt}"` : 'anything'}`));
        await Bun.sleep(POLL_INTERVAL_MS);
      }
      searchFrom = output.length;
      await Bun.sleep(KEY_DELAY_MS);
      proc.terminal?.write(keys);
    }
    let stopWaiting = () => {};
    const deadlineReached = new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), Math.max(deadline - Date.now(), 0));
      stopWaiting = () => clearTimeout(timer);
    });
    const exitCode = await Promise.race([proc.exited, deadlineReached]);
    stopWaiting();
    if (exitCode === null) throw new Error(timeoutMessage('exit'));
    return { exitCode, output };
  } finally {
    proc.kill();
  }
}

/** Runs a script with the sources of `apps/cli` (the `@/` alias) on a pseudo-terminal. */
export function runScriptOnPseudoTerminal(script: string, keystrokes: Keystroke[]): Promise<TerminalRun> {
  return runOnPseudoTerminal([process.execPath, '-e', script], APP_CLI_DIR, keystrokes);
}
