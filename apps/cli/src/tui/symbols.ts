/**
 * Pasted from https://github.com/bombshell-dev/clack/blob/38019c786efc28951a5921f26634cf4c4392367f/packages/prompts/src/common.ts
 */

import type { State } from '@clack/core';
import isUnicodeSupported from 'is-unicode-supported';
import color from 'picocolors';

const unicode = isUnicodeSupported();
const unicodeOr = (c: string, fallback: string) => (unicode ? c : fallback);
const S_STEP_ACTIVE = unicodeOr('◆', '*');
const S_STEP_CANCEL = unicodeOr('■', 'x');
const S_STEP_ERROR = unicodeOr('▲', 'x');
const S_STEP_SUBMIT = unicodeOr('◇', 'o');

const S_BAR = unicodeOr('│', '|');

export const S_RADIO_DISABLED = unicodeOr('⊘', 'x');

export const S_CONNECT_LEFT = unicodeOr('├', '+');

export const symbol = (state: State) => {
  switch (state) {
    case 'initial':
    case 'active':
      return color.cyan(S_STEP_ACTIVE);
    case 'cancel':
      return color.red(S_STEP_CANCEL);
    case 'error':
      return color.yellow(S_STEP_ERROR);
    case 'submit':
      return color.green(S_STEP_SUBMIT);
  }
};

export const S_GRAY_BAR = color.gray(S_BAR);
