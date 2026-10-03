import { server } from '@crm/config/eslint';

// The one package allowed to open database connections.
export default [
  ...server({ root: import.meta.dirname, databaseDriver: true }),
  // Spec 0005: the `auth` schema (global identity, no row level security) is
  // reached only through the identity store, so only src/identity/ imports it.
  {
    files: ['**/*.{ts,js}'],
    ignores: ['src/identity/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // From anywhere (../schema/auth.ts), and from a sibling in src/schema (./auth.ts).
              regex: '(^|/)schema/auth(\\.ts)?$|^\\./auth(\\.ts)?$',
              message: 'Only the identity store (src/identity/) imports the auth schema. Use createIdentityStore().',
            },
          ],
        },
      ],
    },
  },
  // The identity store is Better Auth's one wrapper in this package (its Drizzle adapter), and its test
  // drives Better Auth on it.
  {
    files: ['src/identity/store.ts', 'src/identity/identity.test.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
];
