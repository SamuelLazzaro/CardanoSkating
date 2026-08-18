import { applyD1Migrations, env } from 'cloudflare:test';

// Applies the schema migrations to the isolated test D1 database.
// TEST_MIGRATIONS is provided by vitest.config.ts.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
