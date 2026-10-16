import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/infra/store/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.STORE_PATH ?? 'data/loupe.db',
  },
});
