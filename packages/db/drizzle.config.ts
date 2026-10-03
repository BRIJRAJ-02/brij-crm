import { defineConfig } from 'drizzle-kit';

// drizzle-kit only generates SQL here. Migrations are applied by
// `scripts/migrate.ts` as the owner role, before each deploy.
export default defineConfig({
  dialect: 'postgresql',
  // The `auth` schema is kept out of the index, so only the identity store can import it.
  schema: ['./src/schema/index.ts', './src/schema/auth.ts'],
  out: './migrations',
  strict: true,
  verbose: true,
});
