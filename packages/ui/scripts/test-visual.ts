// `pnpm test:visual [--update]`: the screenshot tests, always inside the
// pinned Playwright Linux image, so fonts and rendering match CI exactly and
// no macOS baseline is ever committed (spec 0003, AC-16).
//
// On your machine it copies the repo's files (not node_modules) into the image
// through Docker or OrbStack, installs there, and runs the `visual` project.
// Baselines are mounted back, so `--update` rewrites them in place, and diffs
// of a failed run land in packages/ui/.vitest/attachments. In CI the job
// already runs in the image, so it runs the project directly.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const IMAGE = 'mcr.microsoft.com/playwright:v1.63.0-noble';
// CI runs on amd64; render there too, even on an Apple Silicon machine.
const PLATFORM = 'linux/amd64';
const UI = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(UI, '../..');
const BASELINES = path.join(UI, '__screenshots__');
const DIFFS = path.join(UI, '.vitest', 'attachments');

/** A baseline over this frames too much of the page; split the story, or opt it out. */
const MAX_BASELINE_BYTES = 200 * 1024;

const update = process.argv.includes('--update');

/** Baselines over the cap, as `path (size)`. Plain git holds them, so each stays small. */
function oversizedBaselines(): string[] {
  if (!existsSync(BASELINES)) return [];
  return readdirSync(BASELINES, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => statSync(file).size > MAX_BASELINE_BYTES)
    .map((file) => `${path.relative(ROOT, file)} (${String(Math.round(statSync(file).size / 1024))} KB)`);
}

function finish(code: number): never {
  const oversized = update ? oversizedBaselines() : [];
  if (oversized.length > 0) {
    console.error(
      `\nThese baselines are over 200 KB, so the story frames too much. Make it smaller, or set parameters.crm.screenshot = false where another story shows the same:\n${oversized.map((file) => `  ${file}`).join('\n')}`,
    );
    process.exit(1);
  }
  process.exit(code);
}
const vitest = ['vitest', 'run', '--project', 'visual', ...(update ? ['--update'] : [])];

if (process.env.CRM_VISUAL_IMAGE === '1') {
  const run = spawnSync('pnpm', ['exec', ...vitest], { cwd: UI, stdio: 'inherit' });
  finish(run.status ?? 1);
}

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error(
    'Screenshots run only in the pinned Linux image, through Docker. Start Docker or OrbStack, then run this again.',
  );
  process.exit(1);
}

const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: ROOT,
  encoding: 'utf8',
});
if (listed.status !== 0) {
  console.error(listed.stderr);
  process.exit(1);
}
const baselinesPrefix = `${path.relative(ROOT, BASELINES)}/`;
const files = listed.stdout
  .split('\0')
  .filter((file) => file !== '' && !file.startsWith(baselinesPrefix) && existsSync(path.join(ROOT, file)));

mkdirSync(BASELINES, { recursive: true });
mkdirSync(DIFFS, { recursive: true });

const inside = [
  'set -e',
  'mkdir -p /work',
  'tar -xf - -C /work',
  'cd /work',
  'corepack enable',
  'pnpm config set store-dir /pnpm-store',
  'pnpm install --frozen-lockfile --prefer-offline',
  `cd packages/ui && pnpm exec ${vitest.join(' ')}`,
].join(' && ');

const docker = spawn(
  'docker',
  [
    'run',
    '--rm',
    '-i',
    `--platform=${PLATFORM}`,
    '--ipc=host',
    '-e',
    'CRM_VISUAL_IMAGE=1',
    '-e',
    'CI=true',
    '-v',
    'crm-visual-pnpm-store:/pnpm-store',
    '-v',
    `${BASELINES}:/work/packages/ui/__screenshots__`,
    '-v',
    `${DIFFS}:/work/packages/ui/.vitest/attachments`,
    IMAGE,
    'bash',
    '-c',
    inside,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);

// macOS tar would add resource forks and extended attributes the image's tar
// warns about; leave them out.
const macOnly = process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs'] : [];
const tar = spawn('tar', [...macOnly, '--null', '-T', '-', '-c', '-f', '-'], {
  cwd: ROOT,
  env: { ...process.env, COPYFILE_DISABLE: '1' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
tar.stdout.pipe(docker.stdin);
tar.stdin.end(files.join('\0'));

docker.on('exit', (code) => {
  if (code !== 0 && !update) {
    console.error(
      `\nScreenshots differ. The diffs are in ${path.relative(ROOT, DIFFS)}. If the change is intended, run \`pnpm test:visual --update\` and commit the new baselines.`,
    );
  }
  finish(code ?? 1);
});
