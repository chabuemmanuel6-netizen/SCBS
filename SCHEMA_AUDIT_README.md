# SCBS schema compatibility audit

This script is a read-only pre-migration check. It does not create tables, alter columns, copy records, or write to the supplied database.

## Safety
- Run only against a **staging copy** of the production SQLite database.
- Never point it at Railway's live `/data/scbs.db`.
- Preserve the matching `scbs.db-wal` and `scbs.db-shm` files when making a consistent SQLite copy; prefer SQLite's backup API or a verified Railway volume backup rather than copying only the main DB file.
- Review the report before any migration is designed or run.

## Run on Windows
From the project folder, after dependencies are installed:

```powershell
node .\scripts\scbs-schema-audit.js "C:\path\to\STAGING\scbs.db"
```

The script opens the selected database in SQLite read-only mode and reports missing tables/columns plus row counts. A missing item is a compatibility finding, not permission to add it blindly. Migration design must account for the existing column meanings and preserve IDs, orders, inventory and customer accounts.
