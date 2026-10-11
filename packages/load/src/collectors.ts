// What the run samples beside its users (spec 0011, AC-201, AC-204): Postgres
// CPU from `docker stats` of the load stack's container, as a share of its
// cap; PgBouncer's longest wait from `SHOW POOLS`; both every 5 seconds over
// the measured window. And the run's facts: the host, Docker, the stack's
// caps and the git commit. Docker is read only for the load stack's own
// project; off the stack the CPU line says it wasn't measured.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { LOAD_STACK, REPO_ROOT } from '@crm/core/load-local';
import { readPoolerPools } from '@crm/db';

const run = promisify(execFile);

/** How often the server is sampled. */
export const SAMPLE_EVERY_MS = 5_000;

/** Runs a command from the repository root, answering its output, or undefined when it fails or is missing. */
async function output(command: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run(command, args, { cwd: REPO_ROOT, timeout: 15_000 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

const compose = (args: readonly string[]) =>
  output('docker', ['compose', '-f', LOAD_STACK.composeFile, '-p', LOAD_STACK.project, ...args]);

/** A load stack container's caps: its CPUs and memory bytes (0 when uncapped). */
export interface StackCap {
  readonly cpus: number;
  readonly memoryBytes: number;
}

/** Each running load stack service's container id and caps, by service name; empty off the stack. */
export async function stackContainers(): Promise<ReadonlyMap<string, { readonly id: string; readonly cap: StackCap }>> {
  const ids = (await compose(['ps', '-q']))?.split('\n').filter(Boolean) ?? [];
  if (ids.length === 0) return new Map();
  const inspected = await output('docker', [
    'inspect',
    '--format',
    '{{.Id}} {{index .Config.Labels "com.docker.compose.service"}} {{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}',
    ...ids,
  ]);
  const entries = (inspected ?? '').split('\n').flatMap((line) => {
    const [id, service, nanoCpus, memory] = line.trim().split(' ');
    if (id === undefined || service === undefined) return [];
    return [[service, { id, cap: { cpus: Number(nanoCpus ?? 0) / 1e9, memoryBytes: Number(memory ?? 0) } }] as const];
  });
  return new Map(entries);
}

/** The container's CPU now as a share of `cpus` (0 to 1 when within its cap), or undefined when unreadable. */
export async function cpuShare(containerId: string, cpus: number): Promise<number | undefined> {
  const text = await output('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}', containerId]);
  const percent = Number.parseFloat(text ?? '');
  if (!Number.isFinite(percent) || cpus <= 0) return undefined;
  return percent / 100 / cpus;
}

/** PgBouncer's longest current wait for `database` in milliseconds (0 when nobody waits), or undefined when unreadable. */
export async function poolerWait(pgbouncerUrl: string, database: string): Promise<number | undefined> {
  try {
    const pools = await readPoolerPools(pgbouncerUrl);
    return Math.max(0, ...pools.filter((pool) => pool.database === database).map((pool) => pool.maxWaitMs));
  } catch {
    return undefined;
  }
}

/** Samples `read` every 5 seconds until stopped, keeping what it answers; undefined answers are dropped. */
export function sampleEvery(read: () => Promise<number | undefined>): {
  readonly stop: () => Promise<readonly number[] | undefined>;
} {
  const values: number[] = [];
  let failed = 0;
  let running: Promise<void> = Promise.resolve();
  const tick = () => {
    running = read().then((value) => {
      if (value === undefined) failed += 1;
      else values.push(value);
    });
  };
  tick();
  const timer = setInterval(tick, SAMPLE_EVERY_MS);
  return {
    stop: async () => {
      clearInterval(timer);
      await running;
      // Nothing read at all means not measured, rather than a line of zeros.
      return values.length === 0 && failed > 0 ? undefined : values;
    },
  };
}

/** The host's model: `hw.model` on a Mac, the CPU's name elsewhere. */
async function hostModel(): Promise<string> {
  if (process.platform === 'darwin') return (await output('sysctl', ['-n', 'hw.model'])) ?? 'unknown Mac';
  try {
    const cpuinfo = await readFile('/proc/cpuinfo', 'utf8');
    const model = /^model name\s*:\s*(.+)$/m.exec(cpuinfo)?.[1];
    if (model !== undefined) return model;
  } catch {
    // Not Linux either: fall back to Node's view of the CPU.
  }
  return os.cpus()[0]?.model ?? 'unknown';
}

/** The host, Docker and the code a run ran on. */
export async function hostFacts() {
  const docker = (await output('docker', ['info', '--format', '{{.NCPU}} {{.MemTotal}}']))?.split(' ');
  const dockerCpus = Number(docker?.[0]);
  const dockerMemory = Number(docker?.[1]);
  return {
    gitCommit: (await output('git', ['rev-parse', 'HEAD'])) ?? 'unknown',
    hostModel: await hostModel(),
    hostCores: os.cpus().length,
    hostMemoryBytes: os.totalmem(),
    ...(Number.isFinite(dockerCpus) && dockerCpus > 0 ? { dockerCpus } : {}),
    ...(Number.isFinite(dockerMemory) && dockerMemory > 0 ? { dockerMemoryBytes: dockerMemory } : {}),
  };
}
