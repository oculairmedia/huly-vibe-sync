# Database Migrations

This directory contains SQL migration scripts for the huly-vibe-sync database.

## Running Migrations

For existing databases, run migrations manually using SQLite:

```bash
sqlite3 /path/to/sync.db < migrations/001_add_letta_columns.sql
```

Or programmatically in Node.js:

```javascript
import fs from 'fs';
import Database from 'better-sqlite3';

const db = new Database('/path/to/sync.db');
const migration = fs.readFileSync('migrations/001_add_letta_columns.sql', 'utf8');
db.exec(migration);
db.close();
```

## Migration Files

- `001_add_letta_columns.sql` - Adds Letta PM agent tracking columns to projects table

## Notes

- New databases automatically include all schema changes via `createTables()` in `lib/database.js`
- These migrations are only needed for existing databases created before the Letta integration
