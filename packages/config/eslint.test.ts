// Locks in the house rules the shared ESLint config enforces. Each preset lints
// a throwaway workspace on disk (type aware rules need real files and a
// tsconfig), and the tests assert which rules fire on each file.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint, type Linter } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, screens, server } from './eslint.js';

type Messages = Map<string, Linter.LintMessage[]>;

const workspaces: string[] = [];

function createWorkspace(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'crm-eslint-')));
  workspaces.push(root);
  const tsconfig = {
    compilerOptions: {
      strict: true,
      target: 'es2024',
      lib: ['es2024', 'dom'],
      module: 'esnext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      allowImportingTsExtensions: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
    include: ['**/*.ts', '**/*.tsx'],
  };
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(tsconfig));
  for (const [file, code] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), code);
  }
  return root;
}

async function lintWorkspace(root: string, config: Linter.Config[]): Promise<Messages> {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config });
  const results = await eslint.lintFiles(['.']);
  return new Map(results.map((result) => [path.relative(root, result.filePath), result.messages]));
}

function rulesFor(messages: Messages, file: string): (string | null)[] {
  const found = messages.get(file);
  if (found === undefined) throw new Error(`${file} was not linted`);
  return found.map((message) => message.ruleId);
}

function messagesFor(messages: Messages, file: string): string[] {
  return (messages.get(file) ?? []).map((message) => message.message);
}

afterAll(() => {
  for (const root of workspaces) rmSync(root, { recursive: true, force: true });
});

describe('screens preset (apps/web)', () => {
  let messages: Messages;

  beforeAll(async () => {
    const root = createWorkspace({
      'src/clean.ts': 'export function greet(name: string): string {\n  return `Hello ${name}`;\n}\n',
      'src/fetches.ts': "export const load = (): Promise<Response> => fetch('/api/records');\n",
      'src/window-fetch.ts': "export const load = (): Promise<Response> => window.fetch('/api/records');\n",
      'src/socket.ts': "export const open = (): WebSocket => new WebSocket('wss://example.test');\n",
      'src/rpc.ts': "import { createORPCClient } from '@orpc/client';\nexport const make = createORPCClient;\n",
      'src/contract.ts': "import { contract } from '@crm/contracts';\nexport const c = contract;\n",
      'src/query.ts': "import { useQuery } from '@tanstack/react-query';\nexport const q = useQuery;\n",
      'src/data-layer.ts': "import { createDataLayer } from '@crm/data';\nexport const make = createDataLayer;\n",
      'src/driver.ts': "import pg from 'pg';\nexport const pool = pg;\n",
      'src/vendor.ts': "import * as Sentry from '@sentry/react';\nexport const sentry = Sentry;\n",
      'src/icon.ts': "import { Building } from 'lucide-react';\nexport const icon = Building;\n",
      'src/styles.ts': "import './screen.css';\nexport const loaded = true;\n",
      'src/Styled.tsx': 'export function Styled() {\n  return <p className="title">Hi</p>;\n}\n',
      'src/Inline.tsx': "export function Inline() {\n  return <p style={{ '--gap': '1' }}>Hi</p>;\n}\n",
      'src/DefaultExport.tsx': 'export default function Screen() {\n  return <p>Hi</p>;\n}\n',
      'src/no-extension.ts': "import { greet } from './clean';\nexport const g = greet;\n",
      'src/with-extension.ts': "import { greet } from './clean.ts';\nexport const g = greet;\n",
      'src/Store.ts': 'class Store {\n  readonly count = 0;\n}\nexport const store = new Store();\n',
      'src/errors.ts': 'export class NotFoundError extends Error {}\n',
      'middleware.ts': [
        'export const config = { matcher: ["/api/:path*"] };',
        'export default function middleware(request: Request): Promise<Response> {',
        "  return fetch(new URL('/api', request.url));",
        '}',
        '',
      ].join('\n'),
      'vite.config.ts': 'export default { plugins: [] };\n',
    });
    messages = await lintWorkspace(root, screens({ root }));
  }, 60_000);

  it('passes clean screen code with no problems at all', () => {
    expect(rulesFor(messages, 'src/clean.ts')).toEqual([]);
  });

  it('refuses a direct fetch from a screen', () => {
    expect(rulesFor(messages, 'src/fetches.ts')).toContain('no-restricted-globals');
    expect(messagesFor(messages, 'src/fetches.ts').join()).toMatch(/through @crm\/data/);
  });

  it('refuses window.fetch, the same call by another name', () => {
    expect(rulesFor(messages, 'src/window-fetch.ts')).toContain('no-restricted-properties');
  });

  it('refuses opening a WebSocket from a screen', () => {
    expect(rulesFor(messages, 'src/socket.ts')).toContain('no-restricted-globals');
  });

  it.each([
    ['the oRPC client', 'src/rpc.ts'],
    ['the contract package', 'src/contract.ts'],
    ['TanStack Query', 'src/query.ts'],
  ])('refuses importing %s in a screen', (_name, file) => {
    expect(rulesFor(messages, file)).toContain('no-restricted-imports');
  });

  it('lets a screen import the client data layer', () => {
    const houseRules = ['no-restricted-imports', '@typescript-eslint/no-restricted-imports', 'no-restricted-syntax'];
    expect(
      rulesFor(messages, 'src/data-layer.ts').filter((rule) => rule !== null && houseRules.includes(rule)),
    ).toEqual([]);
  });

  it('refuses a database driver in a screen', () => {
    expect(rulesFor(messages, 'src/driver.ts')).toContain('no-restricted-imports');
    expect(messagesFor(messages, 'src/driver.ts').join()).toMatch(/Only packages\/db opens database connections/);
  });

  it('refuses a vendor SDK outside its wrapper module', () => {
    expect(rulesFor(messages, 'src/vendor.ts')).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('refuses lucide-react outside the Icon registry', () => {
    expect(rulesFor(messages, 'src/icon.ts')).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('refuses a stylesheet of the screen’s own', () => {
    expect(rulesFor(messages, 'src/styles.ts')).toContain('no-restricted-imports');
  });

  it.each([
    ['className', 'src/Styled.tsx'],
    ['style, even with a custom property', 'src/Inline.tsx'],
  ])('refuses %s on a screen element', (_name, file) => {
    expect(messagesFor(messages, file).join()).toMatch(/built only from library components/);
  });

  it('refuses a default export in screen code', () => {
    expect(messagesFor(messages, 'src/DefaultExport.tsx').join()).toMatch(/Use a named export/);
  });

  it('allows the default export a tool requires (config files and the Vercel middleware)', () => {
    expect(messagesFor(messages, 'vite.config.ts').join()).not.toMatch(/Use a named export/);
    expect(messagesFor(messages, 'middleware.ts').join()).not.toMatch(/Use a named export/);
  });

  it('lets the middleware reach the network, since proxying is its job', () => {
    expect(rulesFor(messages, 'middleware.ts')).not.toContain('no-restricted-globals');
  });

  it('refuses a relative import without its file extension', () => {
    expect(messagesFor(messages, 'src/no-extension.ts').join()).toMatch(/Keep the file extension/);
    expect(messagesFor(messages, 'src/with-extension.ts').join()).not.toMatch(/Keep the file extension/);
  });

  it('refuses classes, except Error subclasses', () => {
    expect(messagesFor(messages, 'src/Store.ts').join()).toMatch(/Functional first/);
    expect(messagesFor(messages, 'src/errors.ts').join()).not.toMatch(/Functional first/);
  });
});

describe('server preset (apps/api, packages/core, packages/contracts)', () => {
  let messages: Messages;

  beforeAll(async () => {
    const root = createWorkspace({
      'src/driver.ts': "import pg from 'pg';\nexport const pool = pg;\n",
      'src/drizzle-driver.ts': "import { drizzle } from 'drizzle-orm/node-postgres';\nexport const d = drizzle;\n",
      'src/logs.ts': "export function report(): void {\n  console.log('hi');\n}\n",
      'src/warns.ts': "export function report(): void {\n  console.error('bad');\n}\n",
      'scripts/cli.ts': "console.log('done');\n",
      'src/any.ts': 'export const parse = (value: any): string => String(value);\n',
      'src/non-null.ts': 'export const first = (items: string[]): string => items[0]!;\n',
      'src/floating.ts': 'async function save(): Promise<void> {}\nexport function run(): void {\n  save();\n}\n',
    });
    messages = await lintWorkspace(root, server({ root }));
  }, 60_000);

  it.each(['src/driver.ts', 'src/drizzle-driver.ts'])('refuses a database driver outside packages/db (%s)', (file) => {
    expect(rulesFor(messages, file)).toContain('no-restricted-imports');
  });

  it('refuses console.log in server code, but allows console.error', () => {
    expect(rulesFor(messages, 'src/logs.ts')).toContain('no-console');
    expect(rulesFor(messages, 'src/warns.ts')).not.toContain('no-console');
  });

  it('lets command line scripts print', () => {
    expect(rulesFor(messages, 'scripts/cli.ts')).not.toContain('no-console');
  });

  it('refuses any and non null assertions', () => {
    expect(rulesFor(messages, 'src/any.ts')).toContain('@typescript-eslint/no-explicit-any');
    expect(rulesFor(messages, 'src/non-null.ts')).toContain('@typescript-eslint/no-non-null-assertion');
  });

  it('refuses a promise left floating (the type aware rules are on)', () => {
    expect(rulesFor(messages, 'src/floating.ts')).toContain('@typescript-eslint/no-floating-promises');
  });
});

describe('server preset for packages/db', () => {
  it('lets packages/db open the database connection', async () => {
    const root = createWorkspace({ 'src/client.ts': "import pg from 'pg';\nexport const pool = pg;\n" });
    const messages = await lintWorkspace(root, server({ root, databaseDriver: true }));
    expect(rulesFor(messages, 'src/client.ts')).not.toContain('no-restricted-imports');
  }, 60_000);
});

describe('client preset (packages/data, packages/ui)', () => {
  let messages: Messages;

  beforeAll(async () => {
    const root = createWorkspace({
      'src/Row.tsx':
        'export function Row({ offset }: { offset: number }) {\n  return <div style={{ "--row-offset": `${offset}px` }} />;\n}\n',
      'src/Raw.tsx': 'export function Raw() {\n  return <div style={{ height: 34 }} />;\n}\n',
      'src/Indirect.tsx':
        "const look = { color: 'red' };\nexport function Indirect() {\n  return <div style={look} />;\n}\n",
      'src/driver.ts': "import pg from 'pg';\nexport const pool = pg;\n",
    });
    messages = await lintWorkspace(root, client({ root }));
  }, 60_000);

  it('lets a component hand a CSS custom property to its stylesheet', () => {
    expect(rulesFor(messages, 'src/Row.tsx')).not.toContain('no-restricted-syntax');
  });

  it('refuses a raw value in an inline style', () => {
    expect(messagesFor(messages, 'src/Raw.tsx').join()).toMatch(/only set CSS custom properties/);
  });

  it('refuses an inline style passed in from a variable', () => {
    expect(messagesFor(messages, 'src/Indirect.tsx').join()).toMatch(/written as an object literal/);
  });

  it('refuses a database driver in client code', () => {
    expect(rulesFor(messages, 'src/driver.ts')).toContain('no-restricted-imports');
  });
});
