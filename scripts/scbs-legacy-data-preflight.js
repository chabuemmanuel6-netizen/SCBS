import Database from 'better-sqlite3';
import path from 'node:path';

// Read-only legacy-data preflight. This script NEVER changes the database.
// Run only against a consistent STAGING copy of the production database.
// Usage: node scripts/scbs-legacy-data-preflight.js "C:\\path\\to\\staging\\scbs.db"

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/scbs-legacy-data-preflight.js <PATH_TO_STAGING_DATABASE>');
  process.exit(2);
}

const databasePath = path.resolve(target);
let db;
try {
  db = new Database(databasePath, { readonly: true, fileMustExist: true });
} catch (error) {
  console.error('Could not open staging database read-only:', error.message);
  process.exit(2);
}

function tableExists(name) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name));
}

function columns(name) {
  if (!tableExists(name)) return [];
  return db.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name);
}

function rows(name) {
  if (!tableExists(name)) return [];
  return db.prepare(`SELECT * FROM "${name}"`).all();
}

function summarizeTextValues(values, maxSamples = 12) {
  const counts = new Map();
  const samples = [];
  for (const value of values) {
    const textValue = value == null ? '<NULL>' : String(value).trim();
    const key = textValue === '' ? '<EMPTY>' : textValue;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (key !== '<EMPTY>' && key !== '<NULL>' && samples.length < maxSamples && !samples.includes(key)) {
      samples.push(key);
    }
  }
  return {
    distinctValues: counts.size,
    mostCommon: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxSamples)
      .map(([value, count]) => ({ value, count })),
    samples
  };
}

function parseJsonShape(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { kind: value == null || value === '' ? 'empty' : 'not_text' };
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return {
        kind: 'array',
        length: parsed.length,
        itemKeys: [...new Set(parsed.flatMap(item =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? Object.keys(item)
            : []
        ))].sort()
      };
    }
    if (parsed && typeof parsed === 'object') {
      return { kind: 'object', keys: Object.keys(parsed).sort() };
    }
    return { kind: typeof parsed };
  } catch {
    return { kind: 'invalid_json' };
  }
}

try {
  const tableNames = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(row => row.name);

  const schema = Object.fromEntries(tableNames.map(name => [name, columns(name)]));
  const counts = {};
  for (const name of tableNames) {
    counts[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
  }

  const priceFields = [];
  if (tableExists('products') && columns('products').includes('price')) {
    priceFields.push({
      table: 'products',
      field: 'price',
      values: summarizeTextValues(rows('products').map(row => row.price))
    });
  }
  if (tableExists('tool_rentals') && columns('tool_rentals').includes('hourly_rate')) {
    priceFields.push({
      table: 'tool_rentals',
      field: 'hourly_rate',
      values: summarizeTextValues(rows('tool_rentals').map(row => row.hourly_rate))
    });
  }

  const orderReport = { present: tableExists('orders') };
  if (orderReport.present) {
    const orderRows = rows('orders');
    const orderColumns = columns('orders');
    orderReport.statuses = orderColumns.includes('status')
      ? summarizeTextValues(orderRows.map(row => row.status), 30)
      : null;
    orderReport.itemsJson = orderColumns.includes('items_json')
      ? {
          shapes: summarizeTextValues(orderRows.map(row => JSON.stringify(parseJsonShape(row.items_json))), 20),
          invalidJsonCount: orderRows.filter(row => parseJsonShape(row.items_json).kind === 'invalid_json').length,
          emptyCount: orderRows.filter(row => ['empty'].includes(parseJsonShape(row.items_json).kind)).length
        }
      : { unavailable: 'No items_json column' };
    orderReport.totalAmount = orderColumns.includes('total_amount')
      ? summarizeTextValues(orderRows.map(row => row.total_amount), 20)
      : { unavailable: 'No total_amount column' };
  }

  const rentalReport = { present: tableExists('tool_rentals') };
  if (rentalReport.present) {
    const rentalRows = rows('tool_rentals');
    const rentalColumns = columns('tool_rentals');
    rentalReport.columns = rentalColumns;
    rentalReport.activeValues = rentalColumns.includes('active')
      ? summarizeTextValues(rentalRows.map(row => row.active), 10)
      : null;
    rentalReport.availableValues = rentalColumns.includes('available')
      ? summarizeTextValues(rentalRows.map(row => row.available), 10)
      : null;
    rentalReport.hourlyRate = rentalColumns.includes('hourly_rate')
      ? summarizeTextValues(rentalRows.map(row => row.hourly_rate), 20)
      : null;
    rentalReport.note = 'Legacy schema has no verified daily rate or quantity field; do not infer these values.';
  }

  const integrity = db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
  const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();

  const report = {
    databasePath,
    mode: 'READ ONLY — no database changes made',
    generatedAt: new Date().toISOString(),
    integrity,
    foreignKeyViolationCount: foreignKeyViolations.length,
    foreignKeyViolations: foreignKeyViolations.slice(0, 50),
    schema,
    rowCounts: counts,
    legacyPriceValues: priceFields,
    orders: orderReport,
    rentals: rentalReport,
    migrationWarnings: [
      'This is a diagnostic report, not a migration.',
      'Price strings must be reviewed before conversion to integer ngwee.',
      'Order JSON shapes and statuses must be mapped explicitly before creating historical order_items.',
      'Legacy rental data does not establish daily rates or rental quantities.',
      'Run only against a consistent staging copy, never the live Railway database.'
    ]
  };

  console.log(JSON.stringify(report, null, 2));
  if (integrity.some(value => value !== 'ok') || foreignKeyViolations.length > 0) {
    process.exitCode = 1;
  }
} finally {
  db.close();
}
