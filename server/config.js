// Reads settings from the environment (.env file). Every setting has a safe
// default, so the app runs with no .env file at all.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const APP_NAME = 'Tucker Tally';
export const APP_ID = 'tucker-tally';
export const APP_VERSION = '1.0.0';

/** Load ROOT/.env into process.env if the file exists. Existing variables win. */
export function loadEnvFile(file = path.join(ROOT, '.env')) {
  try {
    process.loadEnvFile(file);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

function int(value, fallback, min, max) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid number "${value}" in .env (expected a whole number from ${min} to ${max}).`);
  }
  return n;
}

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function stripSlash(url) {
  return url.replace(/\/+$/, '');
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(ROOT, text(env.DATA_DIR, 'data') || 'data');
  const certFile = text(env.HTTPS_CERT_FILE);
  const keyFile = text(env.HTTPS_KEY_FILE);
  return {
    root: ROOT,
    distDir: path.join(ROOT, 'dist'),
    host: text(env.HOST, '0.0.0.0') || '0.0.0.0',
    port: int(env.PORT, 3000, 1, 65535),
    dataDir,
    dbFile: path.join(dataDir, 'tucker-tally.sqlite'),
    backupDir: path.resolve(ROOT, text(env.BACKUP_DIR, 'backups') || 'backups'),
    backupKeep: int(env.BACKUP_KEEP, 14, 1, 365),
    usdaApiKey: text(env.USDA_API_KEY),
    usdaBaseUrl: stripSlash(text(env.USDA_BASE_URL, 'https://api.nal.usda.gov') || 'https://api.nal.usda.gov'),
    offBaseUrl: stripSlash(text(env.OFF_BASE_URL, 'https://world.openfoodfacts.org') || 'https://world.openfoodfacts.org'),
    offCountry: env.OFF_COUNTRY === undefined ? 'australia' : text(env.OFF_COUNTRY).toLowerCase(),
    onlineTimeoutMs: int(env.ONLINE_TIMEOUT_MS, 5000, 200, 30000),
    publicUrl: stripSlash(text(env.PUBLIC_URL)),
    httpsCertFile: certFile ? path.resolve(ROOT, certFile) : '',
    httpsKeyFile: keyFile ? path.resolve(ROOT, keyFile) : '',
    httpsPort: int(env.HTTPS_PORT, 3443, 1, 65535),
    sessionDays: int(env.SESSION_DAYS, 180, 1, 3650),
    bcryptRounds: int(env.BCRYPT_ROUNDS, 12, 4, 15),
  };
}
