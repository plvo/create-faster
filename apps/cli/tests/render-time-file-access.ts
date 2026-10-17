const FILESYSTEM_MODULE = /['"](?:node:)?fs(?:\/promises)?['"]/;
const WORKING_DIRECTORY = /\bprocess\.cwd\b/;

/** The lines of a source that reach the filesystem, through an `fs` module (however it is imported and renamed) or the working directory. */
export function filesystemAccess(source: string): string[] {
  return source.split('\n').filter((line) => FILESYSTEM_MODULE.test(line) || WORKING_DIRECTORY.test(line));
}
