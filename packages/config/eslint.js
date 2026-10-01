// The one ESLint config for the repo. Each workspace's eslint.config.js picks a
// preset (server, client, screens or repoRoot) and passes its own folder, so
// the type aware rules read that workspace's tsconfig. The house rules from
// AGENTS.md are enforced here, so a broken rule fails lint, not review.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Files whose tool requires a default export. */
const DEFAULT_EXPORT_FILES = ['**/*.config.{js,ts}', '**/railway.ts', 'middleware.ts'];

// House rule: only packages/db opens a database connection. Everything else
// reaches Postgres through withWorkspace() from @crm/db.
const databaseDrivers = ['pg', 'pg-pool', 'postgres', 'drizzle-orm/node-postgres', '@neondatabase/serverless'].map(
  (name) => ({
    name,
    message: 'Only packages/db opens database connections. Use withWorkspace() from @crm/db.',
  }),
);

// House rule: screens get data only through the client data layer.
const screenDataImports = {
  paths: [{ name: '@crm/contracts', message: 'Screens import types from @crm/data, never from the contract.' }],
  patterns: [
    {
      group: ['@orpc/*', '@tanstack/db', '@tanstack/*-db-collection', '@tanstack/react-query', '@tanstack/query-core'],
      message: 'Screens get data only through @crm/data, the client data layer.',
    },
    { group: ['axios', 'ky', 'ofetch', 'centrifuge'], message: 'Screens never call the network. Use @crm/data.' },
    {
      regex: '^\\..*\\.css$',
      message: 'Screens carry no CSS of their own. Styles live in packages/ui; add a variant there.',
    },
  ],
};

// House rule: a vendor SDK is imported in exactly one wrapper module. When a
// feature brings a vendor in, its wrapper file switches this rule off for
// itself and nowhere else, for example:
//   { files: ['src/monitoring/sentry.ts'], rules: { '@typescript-eslint/no-restricted-imports': 'off' } }
const vendorSdks = {
  patterns: [
    {
      group: [
        '@sentry/*',
        'posthog-js',
        'posthog-js/*',
        'posthog-node',
        'resend',
        '@aws-sdk/*',
        'centrifuge',
        // Icons: only packages/ui's Icon registry (src/atoms/Icon/icons.ts).
        'lucide-react',
        'lucide-react/*',
      ],
      message: 'Import this vendor only in its one wrapper module, and use the wrapper everywhere else.',
    },
  ],
};

const syntax = {
  defaultExport: {
    selector: 'ExportDefaultDeclaration',
    message: 'Use a named export. Only config files and the Vercel middleware may default export.',
  },
  classes: ['ClassDeclaration', 'ClassExpression'].map((node) => ({
    selector: `${node}:not([superClass.name=/Error$/])`,
    message: 'Functional first: use a function or a factory. Only Error subclasses may be classes.',
  })),
  // Node runs the TypeScript directly, so relative imports keep their extension.
  extensions: ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].map((node) => ({
    selector: `${node}[source.value=/^\\./]:not([source.value=/\\.(ts|tsx|js|css|json|svg|png|webp|woff2)(\\?.*)?$/])`,
    message: 'Keep the file extension on relative imports (./file.ts).',
  })),
  // Raw values belong in tokens and styles in the component's CSS, so an
  // inline style may only hand a CSS custom property to that CSS.
  inlineStyle: [
    {
      selector: "JSXAttribute[name.name='style'] > JSXExpressionContainer > :not(ObjectExpression)",
      message: 'Inline styles may only set CSS custom properties, written as an object literal.',
    },
    {
      selector:
        "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > :not(Property[key.value=/^--/])",
      message: "Inline styles may only set CSS custom properties ('--name'). Raw values belong in tokens.",
    },
  ],
  screenStyling: {
    selector: 'JSXAttribute[name.name=/^(style|className)$/]',
    message: 'Screens are built only from library components. Styling lives in packages/ui; add a variant there.',
  },
};

/** The syntax rule, plus the same rule without the default export ban for files that need one. */
function restrictSyntax(entries) {
  const withoutDefaultExport = entries.filter((entry) => entry !== syntax.defaultExport);
  return [
    { rules: { 'no-restricted-syntax': ['error', ...entries] } },
    { files: DEFAULT_EXPORT_FILES, rules: { 'no-restricted-syntax': ['error', ...withoutDefaultExport] } },
  ];
}

function base(root) {
  return [
    globalIgnores(['**/dist/', '**/.turbo/', '**/.vercel/', '**/*.gen.ts']),
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    {
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: {
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        // Concise callbacks like `(error) => log.error(...)` read better than braces.
        '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-restricted-imports': ['error', vendorSdks],
        'no-console': ['error', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'always'],
      },
    },
    // Command line scripts talk to the person running them.
    { files: ['scripts/**'], rules: { 'no-console': 'off' } },
    // Config files are plain JavaScript outside any tsconfig.
    {
      files: ['**/*.js'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: globals.node },
    },
  ];
}

const react = [
  reactHooks.configs.flat.recommended,
  jsxA11y.configs.recommended,
  { languageOptions: { globals: globals.browser } },
];

/**
 * Server code: apps/api, packages/core, packages/contracts and packages/db.
 * Pass `databaseDriver: true` only for packages/db.
 */
export function server({ root, databaseDriver = false }) {
  return defineConfig(
    base(root),
    { languageOptions: { globals: globals.node } },
    databaseDriver ? [] : { rules: { 'no-restricted-imports': ['error', { paths: databaseDrivers }] } },
    restrictSyntax([syntax.defaultExport, ...syntax.classes, ...syntax.extensions]),
  );
}

/** Client code that isn't a screen: packages/data, and packages/ui once it exists. */
export function client({ root }) {
  return defineConfig(
    base(root),
    react,
    { rules: { 'no-restricted-imports': ['error', { paths: databaseDrivers }] } },
    restrictSyntax([syntax.defaultExport, ...syntax.classes, ...syntax.extensions, ...syntax.inlineStyle]),
  );
}

/** apps/web: screens and routes under src/, plus the Vercel middleware at the root. */
export function screens({ root }) {
  return defineConfig(
    base(root),
    { files: ['src/**/*.{ts,tsx}'], extends: [react] },
    {
      files: ['src/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: [...databaseDrivers, ...screenDataImports.paths], patterns: screenDataImports.patterns },
        ],
        'no-restricted-globals': [
          'error',
          ...['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
            name,
            message: 'Screens never call the network. Read and write through @crm/data.',
          })),
        ],
        'no-restricted-properties': [
          'error',
          ...['window', 'globalThis', 'self'].map((object) => ({
            object,
            property: 'fetch',
            message: 'Screens never call the network. Read and write through @crm/data.',
          })),
        ],
      },
    },
    restrictSyntax([syntax.defaultExport, ...syntax.classes, ...syntax.extensions, syntax.screenStyling]),
    // Files in public/ ship as is: plain browser scripts, outside any tsconfig.
    { files: ['public/**/*.js'], languageOptions: { globals: globals.browser, sourceType: 'script' } },
  );
}

/** Files at the repo root that belong to no workspace (.railway, root configs). */
export function repoRoot({ root }) {
  return defineConfig(
    globalIgnores(['apps/', 'packages/', 'infra/', 'docs/', '.claude/']),
    base(root),
    { languageOptions: { globals: globals.node } },
    restrictSyntax([syntax.defaultExport, ...syntax.classes, ...syntax.extensions]),
  );
}
