// Runs the house rule check as a command against throwaway repos, the way
// `pnpm house-rules` runs it, and asserts the exit code and what it reports.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = path.join(import.meta.dirname, 'house-rules.ts');
const repos: string[] = [];

const README = '# Button\n\nThe one button.\n';
const BUTTON = "import styles from './Button.module.css';\nexport const classes = styles;\n";

function runHouseRules(files: Record<string, string>): { status: number | null; output: string } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'crm-house-rules-')));
  repos.push(root);
  const script = path.join(root, 'packages/config/scripts/house-rules.ts');
  mkdirSync(path.join(root, 'apps'), { recursive: true });
  mkdirSync(path.dirname(script), { recursive: true });
  copyFileSync(SCRIPT, script);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterAll(() => {
  for (const root of repos) rmSync(root, { recursive: true, force: true });
});

describe('house rules check', () => {
  it('passes a component that owns its styles and explains itself', () => {
    const { status, output } = runHouseRules({
      'packages/ui/src/Button/Button.tsx': BUTTON,
      'packages/ui/src/Button/Button.module.css': '.root {}\n',
      'packages/ui/src/Button/README.md': README,
    });
    expect(status).toBe(0);
    expect(output).toContain('no problems found');
  });

  it('refuses a stylesheet in apps/web, since screens carry no CSS', () => {
    const { status, output } = runHouseRules({ 'apps/web/src/features/records/table.css': '.x {}\n' });
    expect(status).toBe(1);
    expect(output).toContain('apps/web/src/features/records/table.css: screens carry no CSS');
  });

  it('refuses a CSS module used by a component in another folder', () => {
    const { status, output } = runHouseRules({
      'packages/ui/src/Button/Button.module.css': '.root {}\n',
      'packages/ui/src/Button/README.md': README,
      'packages/ui/src/Menu/Menu.tsx': "import styles from '../Button/Button.module.css';\nexport const s = styles;\n",
    });
    expect(status).toBe(1);
    expect(output).toContain('Only the component in the same folder may use it');
  });

  it('refuses a CSS module shared by two components', () => {
    const { status, output } = runHouseRules({
      'packages/ui/src/Button/Button.tsx': BUTTON,
      'packages/ui/src/Button/IconButton.tsx': BUTTON,
      'packages/ui/src/Button/Button.module.css': '.root {}\n',
      'packages/ui/src/Button/README.md': README,
    });
    expect(status).toBe(1);
    expect(output).toContain('One component owns its styles');
  });

  it('refuses a CSS module no component imports', () => {
    const { status, output } = runHouseRules({
      'packages/ui/src/Button/Button.module.css': '.root {}\n',
      'packages/ui/src/Button/README.md': README,
    });
    expect(status).toBe(1);
    expect(output).toContain('no component imports it');
  });

  it('asks a styled component for a README saying why it exists', () => {
    const { status, output } = runHouseRules({
      'packages/ui/src/Button/Button.tsx': BUTTON,
      'packages/ui/src/Button/Button.module.css': '.root {}\n',
    });
    expect(status).toBe(1);
    expect(output).toContain('packages/ui/src/Button: add a README.md');
  });

  it('refuses reaching into another package’s CSS module', () => {
    const { status, output } = runHouseRules({
      'packages/ui/src/Button/Button.tsx': BUTTON,
      'packages/ui/src/Button/Button.module.css': '.root {}\n',
      'packages/ui/src/Button/README.md': README,
      'packages/data/src/look.ts': "import chip from '@crm/ui/Chip.module.css';\nexport const c = chip;\n",
    });
    expect(status).toBe(1);
    expect(output).toContain('imports @crm/ui/Chip.module.css. Use the component, not its CSS module');
  });

  it('ignores installed and built files', () => {
    const { status } = runHouseRules({
      'apps/web/node_modules/some-lib/style.css': '.x {}\n',
      'apps/web/dist/assets/index.css': '.x {}\n',
    });
    expect(status).toBe(0);
  });

  it('reports every problem at once, with a count', () => {
    const { status, output } = runHouseRules({
      'apps/web/src/a.css': '.x {}\n',
      'packages/ui/src/Orphan/Orphan.module.css': '.root {}\n',
    });
    expect(status).toBe(1);
    expect(output).toContain('House rules: 3 problem(s)');
  });

  it('ignores import lines quoted inside test files', () => {
    const { status } = runHouseRules({
      'packages/config/scripts/rules.test.ts': 'const fixture = "import chip from \'@crm/ui/Chip.module.css\';";\n',
    });
    expect(status).toBe(0);
  });
});
