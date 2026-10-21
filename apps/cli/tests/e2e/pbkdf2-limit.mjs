// Preloaded into the Node processes of the e2e tests (NODE_OPTIONS=--import=...): PBKDF2 refuses more than 100,000
// iterations, as the runtime of Cloudflare does (payloadcms/payload#18274). Open-source workerd, which runs locally,
// accepts any count, so without this a release that cannot create the first admin on a deployed Worker passes the tests.
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

const LIMIT = 100_000;

const refusal = (iterations) =>
  new DOMException(
    `Pbkdf2 failed: iteration counts above ${LIMIT} are not supported (requested ${iterations})`,
    'NotSupportedError',
  );

const original = {
  pbkdf2: crypto.pbkdf2,
  pbkdf2Sync: crypto.pbkdf2Sync,
  deriveBits: crypto.webcrypto.subtle.deriveBits.bind(crypto.webcrypto.subtle),
};

crypto.pbkdf2 = (password, salt, iterations, ...rest) => {
  if (iterations > LIMIT) throw refusal(iterations);
  return original.pbkdf2(password, salt, iterations, ...rest);
};

crypto.pbkdf2Sync = (password, salt, iterations, ...rest) => {
  if (iterations > LIMIT) throw refusal(iterations);
  return original.pbkdf2Sync(password, salt, iterations, ...rest);
};

crypto.webcrypto.subtle.deriveBits = (algorithm, ...rest) => {
  if (algorithm?.name === 'PBKDF2' && algorithm.iterations > LIMIT) return Promise.reject(refusal(algorithm.iterations));
  return original.deriveBits(algorithm, ...rest);
};

syncBuiltinESMExports();
