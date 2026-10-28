import Database from 'better-sqlite3';
import path from 'node:path';

// Read-only compatibility audit for the SCBS upgrade schema.
// Run ONLY against a staging copy of the database.
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

// These are the target schema names used by the current upgrade code,
// not the legacy production schema. A missing field is a review finding,
// not permission to alter the database automatically.
const expected = {
  admins: ['id', 'email', 'password_hash'],
  customers: ['id', 'full_name', 'email', 'phone', 'password_hash', 'is_disabled'],
  categories: ['id', 'name'],
  products: ['id', 'sku', 'category_id', 'name', 'description', 'image_url', 'product_type', 'price_ngwee', 'stock_quantity', 'is_active'],
  services: ['id', 'name', 'description', 'active', 'image_url'],
  books: ['id', 'title', 'price_ngwee', 'stock_quantity', 'publication_status'],
  rental_items: ['id', 'item_code', 'name', 'description', 'hourly_rate_ngwee', 'daily_rate_ngwee', 'available_quantity', 'condition_status', 'image_url', 'is_active'],
  rental_bookings: ['id', 'booking_number', 'customer_id', 'rental_item_id', 'quantity', 'start_date', 'due_date', 'daily_rate_ngwee', 'total_ngwee', 'status', 'rental_period'],
  orders: ['id', 'order_number', 'customer_id', 'status', 'currency', 'subtotal_ngwee', 'discount_ngwee', 'total_ngwee', 'customer_notes', 'cancellation_reason', 'cancelled_at', 'cancelled_by'],
  order_items: ['id', 'order_id', 'product_id', 'book_id', 'item_name', 'quantity', 'unit_price_ngwee', 'line_total_ngwee'],
  messages: ['id', 'reference_code', 'customer_id', 'name', 'email', 'phone', 'subject', 'message', 'status', 'admin_reply', 'admin_replied_at', 'customer_last_seen_at'],
  audit_logs: ['id', 'admin_id', 'action', 'entity_type', 'entity_id', 'details_json', 'ip_address'],
  customer_addresses: ['id', 'customer_id'],
  order_delivery_addresses: ['id', 'order_id'],
  payments: ['id', 'order_id'],
  order_change_requests: ['id', 'order_id'],
  order_inventory_restorations: ['order_id', 'restored_by', 'restored_at', 'details_json'],
  scbs_posts: ['id', 'title', 'body', 'status', 'created_at'],
  scbs_issue_reports: ['id', 'reference_code', 'name', 'contact', 'category', 'description', 'status'],
  scbs_videos: ['id', 'title', 'youtube_url', 'youtube_video_id', 'status']
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
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
    } catch {
      counts[table] = 'unavailable';
    }
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
