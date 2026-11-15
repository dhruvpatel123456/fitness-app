// Makes a backup of the database right now (works while the app is running).
//   npm run backup
import { createBackupManager } from '../server/backup.js';
import { loadConfig, loadEnvFile } from '../server/config.js';
import { migrate, openDb } from '../server/db.js';

loadEnvFile();
const config = loadConfig();
const db = openDb(config.dbFile);
migrate(db);
const backups = createBackupManager({ db, config });
const made = await backups.run('manual');
console.log(`Backup saved: ${config.backupDir}/${made.name}`);
db.close();
