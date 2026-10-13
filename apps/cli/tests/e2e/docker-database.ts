import { describe } from 'bun:test';
import { $ } from 'bun';
import { getFreePort } from './helpers';

const DATABASE_READY_TIMEOUT = 90_000;
const DATABASE_POLL_INTERVAL = 1_000;
const LABEL_KEY = 'create-faster-e2e';

export type DatabaseEngine = 'postgres' | 'mysql';

interface EngineSetup {
  image: string;
  containerPort: number;
  env: string[];
  readyCommand: string[];
  connectionString: (port: number) => string;
}

const ENGINES: Record<DatabaseEngine, EngineSetup> = {
  postgres: {
    image: 'postgres:17-alpine',
    containerPort: 5432,
    env: ['POSTGRES_PASSWORD=password'],
    readyCommand: ['pg_isready', '-U', 'postgres', '-h', '127.0.0.1'],
    connectionString: (port) => `postgresql://postgres:password@127.0.0.1:${port}/postgres`,
  },
  mysql: {
    image: 'mysql:8',
    containerPort: 3306,
    env: ['MYSQL_ROOT_PASSWORD=password', 'MYSQL_DATABASE=e2e'],
    readyCommand: ['mysqladmin', 'ping', '-h', '127.0.0.1', '-uroot', '-ppassword'],
    connectionString: (port) => `mysql://root:password@127.0.0.1:${port}/e2e`,
  },
};

export interface DatabaseContainer {
  name: string;
  connectionString: string;
}

const dockerAvailable = Bun.spawnSync(['docker', 'info'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;

/** `describe` that is skipped, with a visible warning, when no Docker daemon is reachable. */
export function describeWithDocker(subject: string): typeof describe {
  if (!dockerAvailable) {
    console.warn(`Skipping ${subject}: no Docker daemon reachable (\`docker info\` failed)`);
  }
  return describe.skipIf(!dockerAvailable) as typeof describe;
}

/** Removes the containers a previous run of the same test file left behind, identified by its label only. */
async function removeStaleContainers(label: string): Promise<void> {
  const filter = `label=${LABEL_KEY}=${label}`;
  const stale = (await $`docker ps -aq --filter ${filter}`.quiet().text()).split('\n').filter(Boolean);
  if (stale.length > 0) await $`docker rm -f ${stale}`.quiet().nothrow();
}

export async function removeDatabase(name: string): Promise<void> {
  await $`docker rm -f ${name}`.quiet().nothrow();
}

/** Starts a throwaway database on a free port and waits until it accepts connections. */
export async function startDatabase(engine: DatabaseEngine, label: string): Promise<DatabaseContainer> {
  const { image, containerPort, env, readyCommand, connectionString } = ENGINES[engine];
  await removeStaleContainers(label);

  const port = await getFreePort();
  const name = `create-faster-e2e-${engine}-${process.pid}-${port}`;
  const labelArg = `${LABEL_KEY}=${label}`;
  const envArgs = env.flatMap((variable) => ['-e', variable]);
  await $`docker run -d --rm --name ${name} --label ${labelArg} ${envArgs} -p 127.0.0.1:${port}:${containerPort} ${image}`.quiet();

  const deadline = Date.now() + DATABASE_READY_TIMEOUT;
  while (Date.now() < deadline) {
    const ready = await $`docker exec ${name} ${readyCommand}`.quiet().nothrow();
    if (ready.exitCode === 0) return { name, connectionString: connectionString(port) };
    await Bun.sleep(DATABASE_POLL_INTERVAL);
  }
  await removeDatabase(name);
  throw new Error(`${engine} container ${name} never became ready`);
}
