import { setDefaultTimeout } from 'bun:test';

// Each integration test file imports this module first. The default applies to the files that import it, so unit and e2e tests keep their own timeouts.
setDefaultTimeout(120_000);
