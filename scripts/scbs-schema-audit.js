import Database from 'better-sqlite3';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Read-only audit. Run ONLY against a staging copy of the database.
// Usage: node scripts/scbs-schema-audit.js "C:\\path\\to\\staging\\scbs.db"
const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/scbs-schema-audit.js <PATH_TO_STAGING_DATABASE>');
  process.exit(2);
}

const databasePath = path.resolve(target);
let db;
try {
  db = new Database(databasePath, { readonly: true, fileMustExist: true });
} catch (error) {
  console.error('Could not open the supplied database in read-only mode:', error.message);
  process.exit(2);
}

const expected = {
  admins: ['id', 'email', 'password_hash', 'display_name', 'role', 'is_active', 'last_login_at'],
  customers: ['id', 'name', 'email', 'phone', 'password_hash', 'is_disabled', 'disabled_reason', 'disabled_at', 'disabled_by'],
  products: ['id', 'name', 'description', 'category', 'price', 'stock', 'image_url', 'available'],
  services: ['id', 'name', 'description', 'active', 'image_url'],
  tool_rentals: ['id', 'name', 'category', 'description', 'hourly_rate', 'image_url', 'available', 'active'],
  rental_items: ['id', 'item_code', 'name', 'description', 'hourly_rate_ngwee', 'daily_rate_ngwee', 'available_quantity', 'condition_status', 'image_url', 'is_active'],
  rental_bookings: ['id', 'booking_number', 'customer_id', 'rental_item_id', 'start_at', 'due_at', 'status'],
  orders: ['id', 'customer_id', 'order_number', 'items_json', 'total_amount', 'status', 'cancellation_reason', 'cancelled_at', 'cancelled_by'],
  order_items: ['id', 'order_id', 'product_id', 'book_id', 'item_name', 'quantity'],
  books: ['id', 'title', 'price', 'stock'],
  categories: ['id', 'name'],
  audit_logs: ['id', 'admin_id', 'action', 'entity_type', 'entity_id', 'details_json', 'ip_address'],
  messages: ['id', 'customer_name', 'customer_contact', 'message', 'status', 'admin_reply', 'admin_replied_at', 'customer_last_seen_at']
};

try {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  const report = Object.entries(expected).map(([table, columns]) => {
    if (!tables.has(table)) return { table, exists: false, missingColumns: columns };
    const actual = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(row => row.name));
    return { table, exists: true, missingColumns: columns.filter(column => !actual.has(column)) };
  });
  const counts = {};
  for (const table of tables) {
    if (table.startsWith('sqlite_')) continue;
    try { counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count; }
    catch { counts[table] = 'unavailable'; }
  }
  const result = {
    databasePath,
    mode: 'READ ONLY — no schema or data changes made',
    sqliteIntegrity: db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]),
    tables: report,
    rowCounts: counts,
    hasMissingSchema: report.some(item => !item.exists || item.missingColumns.length > 0)
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.hasMissingSchema) process.exitCode = 1;
} finally {
  db.close();
}
