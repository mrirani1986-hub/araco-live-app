import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// apps/api (works from src/ under tsx and from dist/src/ after build)
export const API_ROOT = here.includes(`${path.sep}dist${path.sep}`)
  ? path.resolve(here, '../..')
  : path.resolve(here, '..');
export const PROJECT_ROOT = path.resolve(API_ROOT, '../..');

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const jwtSecret = required('JWT_SECRET');
if (process.env.NODE_ENV === 'production' && (jwtSecret.length < 32 || /change_me/i.test(jwtSecret))) {
  throw new Error('JWT_SECRET must be a random string of at least 32 characters in production');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4100),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret,
  sessionHours: Number(process.env.SESSION_HOURS ?? 12),
  corsOrigin: (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  storageDir: path.resolve(API_ROOT, process.env.STORAGE_DIR ?? '../../storage'),
  storageDriver: process.env.STORAGE_DRIVER ?? 'local',
  chromiumPath: process.env.CHROMIUM_PATH ?? '',
  pgBinDir: process.env.PG_BIN_DIR ?? '',
  sourceDir: path.resolve(PROJECT_ROOT, 'source-data'),
};
