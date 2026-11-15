// Creates the database (if needed) and brings it up to date.
// Safe to run at any time; the app also does this when it starts.
import { loadConfig, loadEnvFile } from '../server/config.js';
import { migrate, openDb, schemaVersion } from '../server/db.js';

loadEnvFile();
const config = loadConfig();
const db = openDb(config.dbFile);
const applied = migrate(db);
console.log(
  applied.length
    ? `Database ready at ${config.dbFile} (applied: ${applied.join(', ')}).`
    : `Database already up to date at ${config.dbFile} (version ${schemaVersion(db)}).`,
);
db.close();
