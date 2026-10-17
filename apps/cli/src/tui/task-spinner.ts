import { log, spinner } from '@clack/prompts';

type TaskSpinner = ReturnType<typeof spinner>;

/** The code a clack spinner stops with: 0 succeeded, 1 was cancelled, 2 and up failed. */
const STOP_CODE_SUCCESS = 0;

/** Prints a task with a status line that carries no animation, for output that is not a terminal. */
function plainTask(): TaskSpinner {
  return {
    start: (message = '') => log.message(message),
    message: () => {},
    stop: (message = '', code = STOP_CODE_SUCCESS) =>
      code === STOP_CODE_SUCCESS ? log.step(message) : log.error(message),
  };
}

/**
 * A spinner in a terminal. When stdout is redirected (a file, a CI log) the frames and cursor codes would fill the
 * output, so the start and the end of the task are printed as plain lines instead.
 */
export function taskSpinner(): TaskSpinner {
  return process.stdout.isTTY ? spinner() : plainTask();
}
