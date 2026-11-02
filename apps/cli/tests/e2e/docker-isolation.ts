import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $, Glob } from 'bun';
import { getFreePort } from './helpers';

const CONTAINER_LABEL_KEY = 'create-faster-e2e';
const OWNER_LABEL_KEY = 'create-faster-e2e-owner';
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';

// The Docker objects of a run carry the process id of the test process that created it, so a later run removes
// what a dead run left behind and never what a live run still uses.
export const OWNER_LABEL = `${OWNER_LABEL_KEY}=${process.pid}`;

const ISOLATED_PROJECT_NAME = /-e2e-(\d+)-[0-9a-f]{6}$/;

/** A project name no other run, and no other call of this process, produces: `<base>-e2e-<pid>-<random>`. */
export function isolatedProjectName(base: string): string {
  return `${base}-e2e-${process.pid}-${randomBytes(3).toString('hex')}`;
}

/** The process id an isolated project name carries, or null for any other name. */
export function ownerOfProjectName(projectName: string): number | null {
  const pid = ISOLATED_PROJECT_NAME.exec(projectName)?.[1];
  return pid === undefined ? null : Number(pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** True when `pid` names a process that no longer runs. Anything that is not a process id is not an orphan. */
export function isOrphanedOwner(pid: number | null): boolean {
  return pid !== null && Number.isInteger(pid) && pid > 0 && !isProcessAlive(pid);
}

async function dockerLines(args: string[]): Promise<string[]> {
  const output = await $`docker ${args}`.quiet().nothrow().text();
  return output.split('\n').filter(Boolean);
}

/**
 * Removes the containers of an e2e run that no longer exists (`--label` owner process dead). A container without
 * an owner, or whose owner still runs, is left alone, so two runs started at the same time never touch each other.
 */
export async function removeOrphanedContainers(label: string): Promise<void> {
  const rows = await dockerLines([
    'ps',
    '-a',
    '--filter',
    `label=${label}`,
    '--format',
    `{{.ID}} {{.Label "${OWNER_LABEL_KEY}"}}`,
  ]);
  const orphans = rows
    .map((row) => row.split(' '))
    .filter(([, owner]) => isOrphanedOwner(owner ? Number(owner) : null))
    .map(([id]) => id as string);
  if (orphans.length > 0) await $`docker rm -f -v ${orphans}`.quiet().nothrow();
}

export const removeOrphanedDatabases = (): Promise<void> => removeOrphanedContainers(CONTAINER_LABEL_KEY);

/** Removes the containers, networks and volumes of the compose projects whose run (`isolatedProjectName`) is dead. */
export async function removeOrphanedComposeProjects(): Promise<void> {
  const format = `{{.Label "${COMPOSE_PROJECT_LABEL}"}}`;
  const listings = await Promise.all([
    dockerLines(['ps', '-a', '--format', format]),
    dockerLines(['network', 'ls', '--format', format]),
    dockerLines(['volume', 'ls', '--format', format]),
  ]);
  const orphans = [...new Set(listings.flat())].filter((project) => isOrphanedOwner(ownerOfProjectName(project)));

  for (const project of orphans) {
    const filter = `label=${COMPOSE_PROJECT_LABEL}=${project}`;
    const containers = await dockerLines(['ps', '-aq', '--filter', filter]);
    if (containers.length > 0) await $`docker rm -f -v ${containers}`.quiet().nothrow();
    const networks = await dockerLines(['network', 'ls', '-q', '--filter', filter]);
    if (networks.length > 0) await $`docker network rm ${networks}`.quiet().nothrow();
    const volumes = await dockerLines(['volume', 'ls', '-q', '--filter', filter]);
    if (volumes.length > 0) await $`docker volume rm ${volumes}`.quiet().nothrow();
  }
}

const COMPOSE_HOST_PORT = /"(\d+):\d+"/;

/**
 * Gives a generated project a database host port that is free now. The CLI draws one at random between 10000 and
 * 60000 without looking whether it is taken; the port is in `docker-compose.yml` and in the `DATABASE_URL` of every
 * `.env.example`. Call it before the dependency install, while the tree is small.
 */
export async function isolateDatabasePort(projectDir: string): Promise<number> {
  const composePath = join(projectDir, 'docker-compose.yml');
  const compose = await readFile(composePath, 'utf8');
  const generatedPort = COMPOSE_HOST_PORT.exec(compose)?.[1];
  if (generatedPort === undefined) throw new Error(`no host port mapping in ${composePath}`);

  const port = await getFreePort();
  await writeFile(composePath, compose.replace(`"${generatedPort}:`, `"${port}:`));
  for (const relative of new Glob('**/.env.example').scanSync({ cwd: projectDir, dot: true })) {
    const envPath = join(projectDir, relative);
    const env = await readFile(envPath, 'utf8');
    await writeFile(envPath, env.replaceAll(`localhost:${generatedPort}/`, `localhost:${port}/`));
  }
  return port;
}
