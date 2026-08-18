import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  // Le migrazioni vengono lette qui e applicate al D1 di test
  // da test/apply-migrations.ts prima di ogni file di test.
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));

  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Secret fittizi, usati SOLO nella suite di test.
              ADMIN_SECRET: 'chiave-hmac-solo-per-test',
              ADMIN_PASSWORD: 'password-di-test',
            },
          },
        },
      },
    },
  };
});
