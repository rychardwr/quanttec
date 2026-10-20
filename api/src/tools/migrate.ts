import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sql from 'mssql';
import { pendingMigrations } from '../shared/migrations';

// Usage: SQL_CONNECTION_STRING="..." npm run migrate --workspace api
// Applies each pending file of db/migrations in its own transaction and
// records it in schema_migrations. Applied files must never be edited.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

const CREATE_HISTORY_TABLE = `
  IF OBJECT_ID('dbo.schema_migrations') IS NULL
    CREATE TABLE schema_migrations (
      version    VARCHAR(200) NOT NULL CONSTRAINT pk_schema_migrations PRIMARY KEY,
      applied_at DATETIME2(3) NOT NULL CONSTRAINT df_schema_migrations_applied DEFAULT SYSUTCDATETIME()
    );`;

async function migrate(connectionString: string): Promise<void> {
  const pool = await new sql.ConnectionPool(connectionString).connect();
  try {
    await pool.request().batch(CREATE_HISTORY_TABLE);
    const applied = await pool.request().query<{ version: string }>('SELECT version FROM schema_migrations');
    const pending = pendingMigrations(await readdir(MIGRATIONS_DIR), new Set(applied.recordset.map((row) => row.version)));

    if (pending.length === 0) {
      console.log('Database is up to date.');
      return;
    }
    for (const version of pending) {
      await applyMigration(pool, version);
      console.log(`Applied ${version}`);
    }
  } finally {
    await pool.close();
  }
}

async function applyMigration(pool: sql.ConnectionPool, version: string): Promise<void> {
  const script = await readFile(path.join(MIGRATIONS_DIR, version), 'utf8');
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await transaction.request().batch(script);
    await transaction
      .request()
      .input('version', sql.VarChar(200), version)
      .query('INSERT INTO schema_migrations (version) VALUES (@version)');
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

const connectionString = process.env.SQL_CONNECTION_STRING;
if (!connectionString) {
  console.error('Set SQL_CONNECTION_STRING to run the migrations.');
  process.exit(1);
}
migrate(connectionString).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
