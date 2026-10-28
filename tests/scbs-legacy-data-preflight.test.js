import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(projectRoot, 'scripts', 'scbs-legacy-data-preflight.js');

function createLegacyFixture(directory) {
  const databasePath = path.join(directory, 'legacy-fixture.db');
  const db = new Database(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE admins (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price TEXT NOT NULL DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tool_rentals (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      hourly_rate TEXT NOT NULL DEFAULT '',
      available INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      order_number TEXT NOT NULL,
      items_json TEXT NOT NULL DEFAULT '[]',
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pending'
    );
    INSERT INTO admins VALUES (1, 'owner@example.invalid', 'fixture-hash');
    INSERT INTO customers VALUES (1, 'Test Customer', 'customer@example.invalid', '', 'fixture-hash');
    INSERT INTO products VALUES (1, 'Cable', 'K25.00', 7);
    INSERT INTO tool_rentals VALUES (1, 'Test Tool', 'K10/hour', 1, 1);
    INSERT INTO orders VALUES (1, 1, 'TEST-0001', '[{"product_id":1,"quantity":2}]', 50.0, 'Pending');
  `);
  db.close();
  return databasePath;
}

test('legacy data preflight reports diagnostic data without modifying the database', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'scbs-preflight-'));
  try {
    const databasePath = createLegacyFixture(directory);
    const before = new Database(databasePath, { readonly: true });
    const beforeSchema = before.prepare(
      "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"
    ).all();
    const beforeCounts = {
      products: before.prepare('SELECT COUNT(*) AS n FROM products').get().n,
      orders: before.prepare('SELECT COUNT(*) AS n FROM orders').get().n
    };
    before.close();

    const run = spawnSync(process.execPath, [scriptPath, databasePath], {
      cwd: projectRoot,
      encoding: 'utf8'
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const report = JSON.parse(run.stdout);
    assert.match(report.mode, /READ ONLY/);
    assert.equal(report.rowCounts.products, 1);
    assert.equal(report.rowCounts.orders, 1);
    assert.equal(report.legacyPriceValues.find(item => item.table === 'products').values.samples[0], 'K25.00');
    assert.equal(report.orders.itemsJson.invalidJsonCount, 0);
    assert.deepEqual(report.integrity, ['ok']);

    const after = new Database(databasePath, { readonly: true });
    const afterSchema = after.prepare(
      "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"
    ).all();
    const afterCounts = {
      products: after.prepare('SELECT COUNT(*) AS n FROM products').get().n,
      orders: after.prepare('SELECT COUNT(*) AS n FROM orders').get().n
    };
    after.close();

    assert.deepEqual(afterSchema, beforeSchema, 'schema must remain unchanged');
    assert.deepEqual(afterCounts, beforeCounts, 'record counts must remain unchanged');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy data preflight exits with usage guidance when no path is supplied', () => {
  const run = spawnSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Usage: node scripts\/scbs-legacy-data-preflight\.js/);
});
