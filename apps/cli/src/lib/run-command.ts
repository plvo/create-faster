import { spawn } from 'node:child_process';
import { getErrorMessage } from '@/lib/error-utils';

const MAX_CAPTURED_CHARS = 64 * 1024;
const FAILURE_OUTPUT_TAIL_LINES = 20;

interface CommandResult {
  success: boolean;
  output: string;
}

function appendBounded(captured: string, chunk: string): string {
  return (captured + chunk).slice(-MAX_CAPTURED_CHARS);
}

function tailLines(text: string, count: number): string {
  return text.trim().split('\n').slice(-count).join('\n');
}

/**
 * Runs a shell command to completion. Output size can never fail it: only a bounded tail
 * of stderr (stdout when stderr is empty) is kept, as the failure message.
 * There is no timeout: a package manager enforces its own network timeouts, and a wall-clock
 * cap cannot tell a slow install from a stuck one. Ctrl-C reaches the child like any foreground process.
 */
export function runCommand(command: string, cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
    });

    child.on('error', (error) => resolve({ success: false, output: getErrorMessage(error) }));

    child.on('close', (code) =>
      resolve({ success: code === 0, output: tailLines(stderr.trim() ? stderr : stdout, FAILURE_OUTPUT_TAIL_LINES) }),
    );
  });
}
