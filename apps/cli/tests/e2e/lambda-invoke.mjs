// Imports a bundled module in Node.js, as the AWS Lambda runtime does, and records what its handler export is.
// With an event file, also calls the handler with it and records the response.
// Usage: node lambda-invoke.mjs <bundle> <export name> <result.json> [event.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [bundle, exportName, resultPath, eventPath] = process.argv.slice(2);
const handler = (await import(pathToFileURL(bundle).href))[exportName];
const result = { type: typeof handler };

if (eventPath && typeof handler === 'function') {
  result.response = await handler(JSON.parse(readFileSync(eventPath, 'utf-8')), {});
}

writeFileSync(resultPath, JSON.stringify(result));
