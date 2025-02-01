import type { Config } from 'drizzle-kit';

export default {
  schema: 'src/services/SQLiteService/orm/index.ts',
  out: 'src/services/SQLiteService/orm/migrations',
  driver: 'expo',
  dialect: 'sqlite',
} satisfies Config;
