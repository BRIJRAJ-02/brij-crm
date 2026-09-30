import { defineConfig } from 'drizzle-kit';

// drizzle-kit only generates SQL here. Migrations are applied by
// `scripts/migrate.ts` as the owner role, before each deploy.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
