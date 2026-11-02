import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { $, Glob } from 'bun';
import { getFreePort } from './helpers';

export const CONTAINER_LABEL_KEY = 'create-faster-e2e';
const OWNER_LABEL_KEY = 'create-faster-e2e-owner';
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const PROJECT_NAME_MARKER = '-cfe2e-';

// One Docker daemon can serve several machines or pid namespaces (a devcontainer on the host socket, a remote
// DOCKER_HOST), where the pid of a live run reads as dead. An owner is therefore a pid on a named host, and only the
// owners of this host are ever judged.
export const HOST_ID = createHash('sha1').update(hostname()).digest('hex').slice(0, 4);

interface Owner {
  host: string;
  pid: number;
}

const OWNER = /^([0-9a-f]{4})-(\d+)$/;
const ISOLATED_PROJECT_NAME = new RegExp(`${PROJECT_NAME_MARKER}([0-9a-f]{4})-(\\d+)-[0-9a-f]{6}$`);

const formatOwner = ({ host, pid }: Owner): string => `${host}-${pid}`;

export function parseOwner(value: string): Owner | null {
  const match = OWNER.exec(value);
  return match ? { host: match[1] as string, pid: Number(match[2]) } : null;
}

// The Docker objects of a run carry the test process that created it, so a later run removes what a dead run left
// behind and never what a live run still uses.
export const OWNER_LABEL = `${OWNER_LABEL_KEY}=${formatOwner({ host: HOST_ID, pid: process.pid })}`;

const POSTGRES_IDENTIFIER_LIMIT = 63;
const LONGEST_DATABASE_NAME_PREFIX = 'postgres-';
const MAX_PID_DIGITS = 7;
const SUFFIX_FIXED_LENGTH = PROJECT_NAME_MARKER.length + HOST_ID.length + 1 + MAX_PID_DIGITS + 1 + 6;

/** The longest base `isolatedProjectName` accepts: the generated database name `postgres-<project>` must stay a valid PostgreSQL identifier. */
export const MAX_PROJECT_NAME_BASE_LENGTH =
  POSTGRES_IDENTIFIER_LIMIT - LONGEST_DATABASE_NAME_PREFIX.length - SUFFIX_FIXED_LENGTH;

/** A project name no other run, and no other call of this process, produces: `<base>-cfe2e-<host>-<pid>-<random>`. */
export function isolatedProjectName(base: string): string {
  if (base.length > MAX_PROJECT_NAME_BASE_LENGTH) {
    throw new Error(`project name base "${base}" is longer than ${MAX_PROJECT_NAME_BASE_LENGTH} characters`);
  }
  return `${base}${PROJECT_NAME_MARKER}${formatOwner({ host: HOST_ID, pid: process.pid })}-${randomBytes(3).toString('hex')}`;
}

/** The owner an isolated project name carries, or null for any other name. */
export function ownerOfProjectName(projectName: string): Owner | null {
  const match = ISOLATED_PROJECT_NAME.exec(projectName);
  return match ? { host: match[1] as string, pid: Number(match[2]) } : null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** True for an owner on this host whose process no longer runs. No owner, or an owner of another host, is never an orphan. */
export function isOrphanedOwner(owner: Owner | null): boolean {
  return owner !== null && owner.host === HOST_ID && Number.isInteger(owner.pid) && owner.pid > 0 && !isProcessAlive(owner.pid);
}

async function dockerLines(args: string[]): Promise<string[]> {
  const output = await $`docker ${args}`.quiet().nothrow().text();
  return output.split('\n').filter(Boolean);
}

/**
 * Removes the containers with `label` whose owner run no longer exists. A container without an owner, with a
 * malformed one, or owned by a live process or by another host is left alone, so two runs started at the same time
 * never touch each other.
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
    .filter(([, owner]) => isOrphanedOwner(parseOwner(owner ?? '')))
    .map(([id]) => id as string);
  if (orphans.length > 0) await $`docker rm -f -v ${orphans}`.quiet().nothrow();
}

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

// A port written as the host side of a mapping (`"30169:5432"`) or after a colon (`localhost:30169/db`).
const portUse = (port: string): RegExp => new RegExp(`(?<=:)${port}(?!\\d)|(?<!\\d)${port}(?=:\\d)`, 'g');
const bareNumber = (port: string): RegExp => new RegExp(`(?<!\\d)${port}(?!\\d)`);

/**
 * Gives a generated project a database host port that is free now. The CLI picks the port without checking that it
 * is free; it is written into `docker-compose.yml`, every `DATABASE_URL` of the `.env.example` files and the
 * `wrangler.jsonc` Hyperdrive binding. Every text file is rewritten, and the call throws when the old port is still
 * in one afterwards. Call it before the dependency install, while the tree is small.
 */
export async function isolateDatabasePort(projectDir: string): Promise<number> {
  const composePath = join(projectDir, 'docker-compose.yml');
  const generatedPort = COMPOSE_HOST_PORT.exec(await readFile(composePath, 'utf8'))?.[1];
  if (generatedPort === undefined) throw new Error(`no host port mapping in ${composePath}`);

  const port = await getFreePort();
  const leftovers: string[] = [];
  for (const relative of new Glob('**/*').scanSync({ cwd: projectDir, dot: true, onlyFiles: true })) {
    const path = join(projectDir, relative);
    const bytes = await readFile(path);
    if (bytes.includes(0)) continue;

    const text = bytes.toString('utf8');
    if (!bareNumber(generatedPort).test(text)) continue;
    const rewritten = text.replace(portUse(generatedPort), String(port));
    if (rewritten !== text) await writeFile(path, rewritten);
    if (bareNumber(generatedPort).test(rewritten)) leftovers.push(relative);
  }
  if (leftovers.length > 0) {
    throw new Error(`the database port ${generatedPort} is still in ${leftovers.join(', ')} after it moved to ${port}`);
  }
  return port;
}
