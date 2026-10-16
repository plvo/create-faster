import { setDefaultTimeout } from 'bun:test';

const INTEGRATION_TIMEOUT_MS = 120_000;

// Bun evaluates a module once per run and applies a default timeout to the file that sets it, so every integration
// test file calls this function itself instead of relying on an import side effect.
export function setIntegrationTimeout(): void {
  setDefaultTimeout(INTEGRATION_TIMEOUT_MS);
}
