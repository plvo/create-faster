import { log, spinner } from '@clack/prompts';

interface TaskSpinner {
  start(message: string): void;
  message(message: string): void;
  stop(message: string, code?: number): void;
}

const STOP_CODE_ERROR = 1;

/** Prints a task with a status line that carries no animation, for output that is not a terminal. */
function plainTask(): TaskSpinner {
  return {
    start: (message) => log.message(message),
    message: () => {},
    stop: (message, code) => (code === STOP_CODE_ERROR ? log.error(message) : log.step(message)),
  };
}

/**
 * A spinner in a terminal. When stdout is redirected (a file, a CI log) the frames and cursor codes would fill the
 * output, so the start and the end of the task are printed as plain lines instead.
 */
export function taskSpinner(): TaskSpinner {
  return process.stdout.isTTY ? spinner() : plainTask();
}
