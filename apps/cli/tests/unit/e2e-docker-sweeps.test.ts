import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { HOST_ID, removeOrphanedComposeProjects, removeOrphanedContainers } from '../e2e/docker-isolation';

const PROJECT_LABEL = 'label=com.docker.compose.project=';

// A stand-in `docker` first on PATH: it logs its arguments and prints the canned listings of its `data` directory.
const dockerStub = (dir: string): string => `#!/bin/sh
echo "$*" >> "${dir}/log"
case "$1 $2 $3" in
  "ps -a --filter") cat "${dir}/data/containers" ;;
  "ps -a --format") cat "${dir}/data/project-containers" ;;
  "network ls --format") cat "${dir}/data/project-networks" ;;
  "volume ls --format") cat "${dir}/data/project-volumes" ;;
  "ps -aq --filter") echo "c-\${4#${PROJECT_LABEL}}" ;;
  "network ls -q") echo "n-\${5#${PROJECT_LABEL}}" ;;
  "volume ls -q") echo "v-\${5#${PROJECT_LABEL}}" ;;
esac
`;

const OTHER_HOST = HOST_ID === 'ffff' ? 'eeee' : 'ffff';
const REMOVALS = /^(rm|network rm|volume rm) /;

let root: string;
let originalPath: string | undefined;
let deadPid: number;

async function installDockerStub(listings: Record<string, string[]>): Promise<void> {
  const dir = await mkdtemp(join(root, 'run-'));
  await mkdir(join(dir, 'bin'));
  await mkdir(join(dir, 'data'));
  await writeFile(join(dir, 'bin/docker'), dockerStub(dir), { mode: 0o755 });
  for (const [name, lines] of Object.entries(listings)) await writeFile(join(dir, 'data', name), lines.map((line) => `${line}\n`).join(''));
  await writeFile(join(dir, 'log'), '');
  process.env.PATH = `${join(dir, 'bin')}${delimiter}${originalPath}`;
  currentLog = join(dir, 'log');
}

let currentLog = '';
const removals = async (): Promise<string[]> =>
  (await readFile(currentLog, 'utf8')).split('\n').filter((line) => REMOVALS.test(line));

describe('the sweeps of the e2e Docker helpers', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'create-faster-docker-stub-'));
    const finished = Bun.spawn(['true']);
    await finished.exited;
    deadPid = finished.pid;
  });

  beforeEach(() => {
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('removeOrphanedContainers', () => {
    const owner = (host: string, pid: number): string => `${host}-${pid}`;

    test('removes only the containers of a finished run on this host', async () => {
      await installDockerStub({
        containers: [
          `live-run ${owner(HOST_ID, process.pid)}`,
          `dead-run ${owner(HOST_ID, deadPid)}`,
          'no-label ',
          'malformed-owner not-an-owner',
          `bare-pid ${deadPid}`,
          `other-host ${owner(OTHER_HOST, deadPid)}`,
        ],
      });

      await removeOrphanedContainers('create-faster-e2e');

      expect(await removals()).toEqual(['rm -f -v dead-run']);
    });

    test('removes nothing when no container belongs to a finished run on this host', async () => {
      await installDockerStub({
        containers: [`live-run ${owner(HOST_ID, process.pid)}`, 'no-label ', `other-host ${owner(OTHER_HOST, deadPid)}`],
      });

      await removeOrphanedContainers('create-faster-e2e');

      expect(await removals()).toEqual([]);
    });
  });

  describe('removeOrphanedComposeProjects', () => {
    const project = (base: string, host: string, pid: number): string => `${base}-cfe2e-${host}-${pid}-abc123`;

    test('removes the containers, networks and volumes of the finished runs of this host, whichever listing names them', async () => {
      const live = project('live', HOST_ID, process.pid);
      const deadWithContainer = project('dead-container', HOST_ID, deadPid);
      const deadWithNetwork = project('dead-network', HOST_ID, deadPid);
      const deadWithVolume = project('dead-volume', HOST_ID, deadPid);
      const otherHost = project('other', OTHER_HOST, deadPid);
      const foreignTool = `tool-e2e-${deadPid}-abc123`;
      await installDockerStub({
        'project-containers': [live, deadWithContainer, 'my-app', foreignTool, ''],
        'project-networks': [deadWithNetwork, otherHost, live],
        'project-volumes': [deadWithVolume, 'my-app'],
      });

      await removeOrphanedComposeProjects();

      expect(await removals()).toEqual(
        [deadWithContainer, deadWithNetwork, deadWithVolume].flatMap((name) => [
          `rm -f -v c-${name}`,
          `network rm n-${name}`,
          `volume rm v-${name}`,
        ]),
      );
    });

    test('removes nothing when every project is live, on another host or not made by these tests', async () => {
      await installDockerStub({
        'project-containers': [project('live', HOST_ID, process.pid), 'my-app'],
        'project-networks': [project('other', OTHER_HOST, deadPid)],
        'project-volumes': [`tool-e2e-${deadPid}-abc123`],
      });

      await removeOrphanedComposeProjects();

      expect(await removals()).toEqual([]);
    });
  });
});
