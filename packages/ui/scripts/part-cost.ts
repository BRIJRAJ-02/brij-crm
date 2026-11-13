// `node scripts/part-cost.ts`: what each library folder costs to load (spec 0072, AC-8). Every CSS module is minified
// by Lightning CSS and every component TS or TSX file (not tests, stories or type files) is transformed and minified
// by Oxc, the two tools the production build uses; each is gzipped. With `--ref <sha>` it reads the files at that
// commit through git, so the base can be measured without checking it out.
//
//   node scripts/part-cost.ts --tier 1                  the tier's folders on the working tree
//   node scripts/part-cost.ts --tier 1 --ref f81623f0c  the same folders at the base commit
//   node scripts/part-cost.ts --tier 1 --against f81623f0c   both, side by side, with the change
//   node scripts/part-cost.ts Button Tag                named folders
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { minifySync, transformSync } from 'rolldown/utils';

const UI = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(UI, '../..');
const SRC = 'src';
const KINDS = ['atoms', 'molecules', 'modules'] as const;

// The tiers of spec 0072's parts list: every folder each tier touches, folded parts included.
const TIERS: Readonly<Record<string, readonly string[]>> = {
  '1': [
    'Button',
    'Icon',
    'ProviderMark',
    'Kbd',
    'Link',
    'Code',
    'Tooltip',
    'Tag',
    'Badge',
    'StatusDot',
    'Avatar',
    'PersonLine',
    'RecordChip',
    'LinkChip',
    'Mention',
    'Variable',
    'RecordChipList',
    'QrCode',
    'Checkbox',
    'Radio',
    'Switch',
    'Slider',
    'DragHandle',
  ],
  '2a': [
    'Field',
    'FieldLabel',
    'FieldError',
    'FieldGroup',
    'Form',
    'Select',
    'CurrencyPicker',
    'CountryPicker',
    'PhoneField',
    'CodeInput',
    'DatePicker',
    'DateNav',
    'ChoiceChips',
    'SegmentedControl',
    'IconPicker',
    'FileDrop',
    'FileItem',
    'FileIcon',
  ],
  '2b': [
    'Menu',
    'Popover',
    'InfoTip',
    'Tabs',
    'SectionTabs',
    'Breadcrumbs',
    'Pagination',
    'Disclosure',
    'Steps',
    'Stepper',
  ],
  '2c': [
    'Callout',
    'Card',
    'Stats',
    'RecordStats',
    'TileGrid',
    'EmptyState',
    'SpotIllustration',
    'DescriptionList',
    'AttributeList',
    'FloatingBar',
    'BulkActionBar',
    'SaveBar',
    'PublishBar',
    'VisitorBar',
    'Sentence',
    'SocialLinks',
    'SocialLinksEditor',
  ],
  '3a': [
    'DataGrid',
    'Table',
    'SampleTable',
    'Board',
    'Chart',
    'BarStrip',
    'RecordHeader',
    'RecordPanel',
    'RecordLayout',
    'RelatedRecords',
    'ActivityFeed',
    'BookingChanges',
    'CommentThread',
    'CommentComposer',
    'NoteList',
    'TaskList',
    'NotificationList',
    'CommandPalette',
    'ShortcutHelp',
  ],
};

interface LightningCss {
  readonly transform: (options: {
    readonly filename: string;
    readonly code: Uint8Array;
    readonly minify: boolean;
    readonly cssModules?: { readonly pattern: string };
    readonly errorRecovery: boolean;
  }) => { readonly code: Uint8Array };
}

const viteRequire = createRequire(createRequire(path.join(UI, 'package.json')).resolve('vite/package.json'));
const lightning = viteRequire('lightningcss') as LightningCss;

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const tier = option('--tier');
const ref = option('--ref');
const against = option('--against');
const named = args.filter((each, at) => !each.startsWith('--') && !args[at - 1]?.startsWith('--'));
// `--tier 2` is its three batches together.
const tierFolders = (name: string): readonly string[] =>
  TIERS[name] ?? Object.entries(TIERS).flatMap(([key, list]) => (key.startsWith(name) ? list : []));
const folders = tier === undefined ? named : tierFolders(tier);
if (folders.length === 0) {
  throw new Error('Name a tier (--tier 1) or one or more folders.');
}

const git = (...gitArgs: readonly string[]): string =>
  execFileSync('git', ['-C', ROOT, ...gitArgs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/** The folder's files as name and contents, at a commit or on the working tree. */
const filesOf = (folder: string, at: string | undefined): ReadonlyArray<readonly [string, Buffer]> => {
  for (const kind of KINDS) {
    const dir = `${SRC}/${kind}/${folder}`;
    if (at === undefined) {
      const full = path.join(UI, dir);
      if (!existsSync(full)) continue;
      return readdirSync(full).map((file) => [file, readFileSync(path.join(full, file))] as const);
    }
    let listed: string;
    try {
      listed = git('ls-tree', '--name-only', `${at}:packages/ui/${dir}`).trim();
    } catch {
      continue;
    }
    if (listed === '') continue;
    return listed
      .split('\n')
      .map((file) => [file, execFileSync('git', ['-C', ROOT, 'show', `${at}:packages/ui/${dir}/${file}`])] as const);
  }
  return [];
};

const isComponentSource = (file: string): boolean =>
  /\.tsx?$/.test(file) && !/\.(test|stories|d)\.tsx?$/.test(file) && !/\.(browser|perf)\.test\.tsx$/.test(file);

const gzip = (bytes: Uint8Array): number => gzipSync(bytes, { level: 9 }).length;

interface Cost {
  readonly css: number;
  readonly js: number;
}

const costOf = (folder: string, at: string | undefined): Cost => {
  let css = 0;
  let js = 0;
  for (const [file, contents] of filesOf(folder, at)) {
    if (file.endsWith('.css')) {
      const { code } = lightning.transform({
        filename: file,
        code: contents,
        minify: true,
        ...(file.endsWith('.module.css') ? { cssModules: { pattern: 'ws-x-[local]' } } : {}),
        errorRecovery: true,
      });
      css += gzip(code);
    } else if (isComponentSource(file)) {
      const stripped = transformSync(file, contents.toString('utf8'), { jsx: { runtime: 'automatic' } });
      const { code } = minifySync(file.replace(/\.tsx?$/, '.js'), stripped.code);
      js += gzip(Buffer.from(code));
    }
  }
  return { css, js };
};

const table = (label: string, at: string | undefined): ReadonlyMap<string, Cost> => {
  const costs = new Map(folders.map((folder) => [folder, costOf(folder, at)] as const));
  if (against === undefined) {
    console.log(`${label}\n${'Folder'.padEnd(16)}${'CSS'.padStart(8)}${'JS'.padStart(8)}`);
    for (const [folder, cost] of costs)
      console.log(`${folder.padEnd(16)}${String(cost.css).padStart(8)}${String(cost.js).padStart(8)}`);
  }
  return costs;
};

const sum = (costs: ReadonlyMap<string, Cost>): Cost =>
  [...costs.values()].reduce((total, each) => ({ css: total.css + each.css, js: total.js + each.js }), {
    css: 0,
    js: 0,
  });

if (against === undefined) {
  const costs = table(ref === undefined ? 'Working tree' : `At ${ref}`, ref);
  const total = sum(costs);
  console.log(
    `${'Total'.padEnd(16)}${String(total.css).padStart(8)}${String(total.js).padStart(8)}  (${total.css + total.js} B gzipped)`,
  );
} else {
  const before = table(`At ${against}`, against);
  const after = table('Working tree', undefined);
  const change = (from: number, to: number): string =>
    from === 0 ? 'new' : `${Math.round(((to - from) / from) * 1000) / 10}%`;
  console.log(`${'Folder'.padEnd(16)}${'CSS'.padStart(14)}${'JS'.padStart(14)}${'Both'.padStart(10)}`);
  for (const folder of folders) {
    const from = before.get(folder) ?? { css: 0, js: 0 };
    const to = after.get(folder) ?? { css: 0, js: 0 };
    console.log(
      `${folder.padEnd(16)}${`${from.css}→${to.css}`.padStart(14)}${`${from.js}→${to.js}`.padStart(14)}${change(from.css + from.js, to.css + to.js).padStart(10)}`,
    );
  }
  const from = sum(before);
  const to = sum(after);
  console.log(
    `${'Total'.padEnd(16)}${`${from.css}→${to.css}`.padStart(14)}${`${from.js}→${to.js}`.padStart(14)}${change(from.css + from.js, to.css + to.js).padStart(10)}`,
  );
}
