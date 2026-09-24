import { applyD1Migrations, env } from 'cloudflare:test';

// Applica le migrazioni dello schema al database D1 isolato dei test.
// TEST_MIGRATIONS è fornita da vitest.config.ts.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
