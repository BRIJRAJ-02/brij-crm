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

  it('asks a library component for its README and its stories', () => {
    const { status, output } = runHouseRules({
      'packages/ui/src/atoms/Badge/Badge.tsx': 'export const Badge = () => null;\n',
    });
    expect(status).toBe(1);
    expect(output).toContain('packages/ui/src/atoms/Badge: add a README.md');
    expect(output).toContain('packages/ui/src/atoms/Badge: add a stories file');
  });

  it('passes a library component with its README and stories', () => {
    const { status } = runHouseRules({
      'packages/ui/src/atoms/Badge/Badge.tsx': 'export const Badge = () => null;\n',
      'packages/ui/src/atoms/Badge/Badge.stories.tsx': "export default { title: 'Atoms/Badge' };\n",
      'packages/ui/src/atoms/Badge/README.md': '# Badge\n',
    });
    expect(status).toBe(0);
  });

  it('refuses two CSS modules with the same name, since class names carry no hash', () => {
    const { output } = runHouseRules({
      'packages/ui/src/atoms/Tag/Tag.tsx': "import styles from './Tag.module.css';\nexport const s = styles;\n",
      'packages/ui/src/atoms/Tag/Tag.module.css': '.root {}\n',
      'packages/ui/src/molecules/Tag/Tag.tsx': "import styles from './Tag.module.css';\nexport const s = styles;\n",
      'packages/ui/src/molecules/Tag/Tag.module.css': '.root {}\n',
    });
    expect(output).toContain('the CSS module name "Tag" is used more than once');
  });

  it('refuses two stories files with the same title, since story ids come from it', () => {
    const { output } = runHouseRules({
      'packages/ui/src/atoms/One/One.stories.tsx': "export default { title: 'Atoms/Thing' };\n",
      'packages/ui/src/atoms/Two/Two.stories.tsx': "export default { title: 'Atoms/Thing' };\n",
    });
    expect(output).toContain('the story title "Atoms/Thing" is used more than once');
  });
  it('refuses a size token borrowed outside its owner, and allows the owner', () => {
    const borrowed = runHouseRules({
      'packages/ui/src/molecules/Modal/Modal.tsx':
        "import styles from './Modal.module.css';\nexport const classes = styles;\n",
      'packages/ui/src/molecules/Modal/Modal.module.css': '.root { inline-size: calc(2 * var(--size-sidebar)); }\n',
      'packages/ui/src/molecules/Modal/README.md': '# Modal\n\nA dialog.\n',
      'packages/ui/src/molecules/Modal/Modal.stories.tsx': "export default { title: 'Molecules/Modal' };\n",
    });
    expect(borrowed.status).toBe(1);
    expect(borrowed.output).toContain('Modal.module.css: --size-sidebar belongs to another component');

    const owned = runHouseRules({
      'packages/ui/src/atoms/Checkbox/Checkbox.tsx':
        "import styles from './Checkbox.module.css';\nexport const classes = styles;\n",
      'packages/ui/src/atoms/Checkbox/Checkbox.module.css': '.box { inline-size: var(--size-check); }\n',
      'packages/ui/src/atoms/Checkbox/README.md': '# Checkbox\n\nA checkbox.\n',
      'packages/ui/src/atoms/Checkbox/Checkbox.stories.tsx': "export default { title: 'Atoms/Checkbox' };\n",
    });
    expect(owned.output).not.toContain('belongs to another component');
  });
});
