import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-this-secret-please-32chars';
const dbDir = process.env.NODE_ENV === 'production' ? '/data' : __dirname;
const dbPath = path.join(dbDir, 'scbs.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaSql = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  price TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Authorized Service Tool',
  description TEXT NOT NULL DEFAULT '',
  hourly_rate TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  available INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS advertisements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  customer_contact TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'New',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL UNIQUE,
  items_json TEXT NOT NULL DEFAULT '[]',
  total_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  customer_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
`;

db.exec(schemaSql);

function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password || password === 'CHANGE_THIS_BEFORE_FIRST_RUN') return;

  const existing = db.prepare('SELECT id FROM admins WHERE email=?').get(email);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO admins(email,password_hash) VALUES(?,?)').run(email, hash);
  }
}

ensureAdmin();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

const customerRegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(80).optional().default(''),
  password: z.string().min(10).max(200),
});

const messageSchema = z.object({
  customer_name: z.string().trim().min(1).max(100),
  customer_contact: z.string().trim().min(3).max(100),
  message: z.string().trim().min(1).max(2000),
});

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).default(''),
  price: z.string().trim().max(100).default(''),
  stock: z.coerce.number().int().min(0).default(0),
  image_url: z.string().trim().max(1000).default(''),
  available: z.boolean().default(true),
});

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
});

const toolRentalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(100).default('Authorized Service Tool'),
  description: z.string().trim().max(1000).default(''),
  hourly_rate: z.string().trim().max(100).default(''),
  image_url: z.string().trim().max(1000).default(''),
  available: z.boolean().default(true),
  active: z.boolean().default(true),
});

const adSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(2000).default(''),
  image_url: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
});

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function createSession(adminId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions(id,admin_id,expires_at) VALUES(?,?,?)').run(id, adminId, expires);
  return { id, expires };
}

function createCustomerSession(customerId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  db.prepare('INSERT INTO customer_sessions(id,customer_id,expires_at) VALUES(?,?,?)').run(id, customerId, expires);
  return { id, expires };
}

function getAdmin(req) {
  const raw = req.cookies.scbs_session;
  if (!raw) return null;
  const [id, mac] = raw.split('.');
  if (!id || !mac || sign(id) !== mac) return null;

  const row = db.prepare('SELECT a.id,a.email,s.expires_at FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.id=?').get(id);
  if (!row || row.expires_at < Date.now()) {
    if (row) db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    return null;
  }

  return row;
}

function getCustomer(req) {
  const raw = req.cookies.scbs_customer_session;
  if (!raw) return null;
  const [id, mac] = raw.split('.');
  if (!id || !mac || sign(id) !== mac) return null;

  const row = db.prepare(`
    SELECT c.id, c.name, c.email, c.phone, s.expires_at
    FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.id = ?
  `).get(id);

  if (!row || row.expires_at < Date.now()) {
    if (row) db.prepare('DELETE FROM customer_sessions WHERE id=?').run(id);
    return null;
  }

  return row;
}

function requireAdmin(req, res, next) {
  const admin = getAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Authentication required' });
  req.admin = admin;
  next();
}

function requireCustomer(req, res, next) {
  const customer = getCustomer(req);
  if (!customer) return res.status(401).json({ error: 'Customer login required' });
  req.customer = customer;
  next();
}

function cleanSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('DELETE FROM customer_sessions WHERE expires_at < ?').run(Date.now());
}

setInterval(cleanSessions, 30 * 60 * 1000).unref();

app.use('/api/public', publicLimiter);

app.post('/api/auth/login', authLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid login details' });

  const email = parsed.data.email.toLowerCase();
  const admin = db.prepare('SELECT * FROM admins WHERE email=?').get(email);
  if (!admin || !bcrypt.compareSync(parsed.data.password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const session = createSession(admin.id);
  res.cookie('scbs_session', `${session.id}.${sign(session.id)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.json({ ok: true, email: admin.email });
});

app.post('/api/auth/logout', requireAdmin, (req, res) => {
  const raw = req.cookies.scbs_session;
  const id = raw?.split('.')[0];
  if (id) db.prepare('DELETE FROM sessions WHERE id=?').run(id);

  res.clearCookie('scbs_session');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const admin = getAdmin(req);
  res.json({ authenticated: !!admin, email: admin?.email || null });
});

app.post('/api/customers/register', publicLimiter, (req, res) => {
  const parsed = customerRegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please provide a valid name, email, phone (optional) and password (10+ characters).' });
  }

  const data = parsed.data;
  const email = data.email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM customers WHERE email=?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'A customer account with this email already exists.' });
  }

  const hash = bcrypt.hashSync(data.password, 12);
  const result = db.prepare('INSERT INTO customers(name,email,phone,password_hash) VALUES(?,?,?,?)').run(
    data.name.trim(),
    email,
    data.phone.trim(),
    hash,
  );

  const session = createCustomerSession(Number(result.lastInsertRowid));
  res.cookie('scbs_customer_session', `${session.id}.${sign(session.id)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.status(201).json({
    ok: true,
    customer: { id: Number(result.lastInsertRowid), name: data.name.trim(), email },
  });
});

app.post('/api/customers/login', authLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid login details.' });
  }

  const email = parsed.data.email.toLowerCase();
  const customer = db.prepare('SELECT * FROM customers WHERE email=?').get(email);
  if (!customer || !bcrypt.compareSync(parsed.data.password, customer.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const session = createCustomerSession(customer.id);
  res.cookie('scbs_customer_session', `${session.id}.${sign(session.id)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.json({ ok: true, customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone } });
});

app.post('/api/customers/logout', requireCustomer, (req, res) => {
  const raw = req.cookies.scbs_customer_session;
  const id = raw?.split('.')[0];
  if (id) db.prepare('DELETE FROM customer_sessions WHERE id=?').run(id);

  res.clearCookie('scbs_customer_session');
  res.json({ ok: true });
});

app.get('/api/customers/me', (req, res) => {
  const customer = getCustomer(req);
  if (!customer) return res.json({ authenticated: false, customer: null });

  res.json({
    authenticated: true,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone || '',
    },
  });
});

app.get('/api/public/data', (req, res) => {
  res.json({
    products: db.prepare('SELECT id,name,category,description,price,stock,image_url,available FROM products WHERE available=1 ORDER BY id DESC').all(),
    services: db.prepare('SELECT id,name,description FROM services WHERE active=1 ORDER BY id DESC').all(),
    toolRentals: db.prepare(`
      SELECT id,name,category,description,hourly_rate,image_url
      FROM tool_rentals
      WHERE active=1 AND available=1
      ORDER BY id DESC
    `).all(),
    advertisements: db.prepare('SELECT id,title,body,image_url FROM advertisements WHERE active=1 ORDER BY id DESC').all(),
  });
});

app.post('/api/public/messages', publicLimiter, (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please provide valid contact details and message' });
  }

  db.prepare('INSERT INTO messages(customer_name,customer_contact,message,status) VALUES(?,?,?,?)').run(
    parsed.data.customer_name,
    parsed.data.customer_contact,
    parsed.data.message,
    'New',
  );

  res.status(201).json({ ok: true, message: 'Message sent successfully.' });
});

app.post('/api/orders', requireCustomer, (req, res) => {
  const schema = z.object({
    items: z.array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(100),
      })
    ).min(1).max(50),
    customerNote: z.string().trim().max(500).optional().default(''),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Provide valid product IDs and quantities.' });
  }

  const quantities = new Map();
  for (const item of parsed.data.items) {
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
  }

  try {
    const createOrder = db.transaction(() => {
      const orderItems = [];
      let totalAmount = 0;

      for (const [productId, quantity] of quantities) {
        const product = db.prepare(`
          SELECT id, name, price, available, stock
          FROM products
          WHERE id = ?
        `).get(productId);

        if (!product || product.available !== 1) {
          throw new Error(`Product ${productId} is unavailable.`);
        }

        if (product.stock !== null && product.stock < quantity) {
          throw new Error(`Insufficient stock for ${product.name}.`);
        }

        if (product.stock !== null) {
          const stockUpdate = db.prepare(`
            UPDATE products
            SET stock = stock - ?
            WHERE id = ?
              AND available = 1
              AND stock >= ?
          `).run(quantity, productId, quantity);

          if (stockUpdate.changes !== 1) {
            throw new Error(`Insufficient stock for ${product.name}.`);
          }
        }

        const priceText = String(product.price).trim();
        if (!/^\d+(\.\d{1,2})?$/.test(priceText)) {
          throw new Error(`Invalid price configured for ${product.name}.`);
        }

        const price = Number(priceText);
        totalAmount += price * quantity;

        orderItems.push({
          productId: product.id,
          name: product.name,
          unitPrice: price,
          quantity,
        });
      }

      const orderNumber = 'SCBS-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

      const result = db.prepare(`
        INSERT INTO orders (customer_id, order_number, items_json, total_amount, status, customer_note)
        VALUES (?, ?, ?, ?, 'Pending', ?)
      `).run(
        req.customer.id,
        orderNumber,
        JSON.stringify(orderItems),
        Number(totalAmount.toFixed(2)),
        parsed.data.customerNote
      );

      return {
        id: Number(result.lastInsertRowid),
        orderNumber,
        items: orderItems,
        totalAmount: Number(totalAmount.toFixed(2)),
        status: 'Pending',
      };
    });

    const order = createOrder();
    return res.status(201).json({
      ok: true,
      message: 'Order submitted successfully.',
      order,
    });
  } catch (error) {
    if (error.message.startsWith('Product ') || error.message.startsWith('Insufficient stock') || error.message.startsWith('Invalid price')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Order creation failed:', error.message);
    return res.status(500).json({ error: 'Unable to create the order right now.' });
  }
});

app.get('/api/orders', requireCustomer, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, customer_id, order_number, items_json, total_amount, status, customer_note, created_at, updated_at
      FROM orders
      WHERE customer_id = ?
      ORDER BY id DESC
    `).all(req.customer.id);

    const orders = rows.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      items: JSON.parse(row.items_json || '[]'),
      totalAmount: row.total_amount,
      status: row.status,
      customerNote: row.customer_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({ ok: true, orders });
  } catch (error) {
    console.error('Failed to retrieve customer orders:', error.message);
    res.status(500).json({ error: 'Unable to retrieve orders right now.' });
  }
});

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  res.json({
    products: db.prepare('SELECT * FROM products ORDER BY id DESC').all(),
    services: db.prepare('SELECT * FROM services ORDER BY id DESC').all(),
    toolRentals: db.prepare('SELECT * FROM tool_rentals ORDER BY id DESC').all(),
    advertisements: db.prepare('SELECT * FROM advertisements ORDER BY id DESC').all(),
    messages: db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 100').all(),
  });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, customer_id, order_number, items_json, total_amount, status, customer_note, created_at, updated_at
      FROM orders
      ORDER BY id DESC
      LIMIT 200
    `).all();

    const orders = rows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      orderNumber: row.order_number,
      items: JSON.parse(row.items_json || '[]'),
      totalAmount: row.total_amount,
      status: row.status,
      customerNote: row.customer_note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({ ok: true, orders });
  } catch (error) {
    console.error('Failed to retrieve admin orders:', error.message);
    res.status(500).json({ error: 'Unable to retrieve orders right now.' });
  }
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid product' });

  const x = parsed.data;
  const result = db.prepare(`
    INSERT INTO products (name,category,description,price,stock,image_url,available)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    x.name,
    x.category,
    x.description,
    x.price,
    x.stock,
    x.image_url,
    x.available ? 1 : 0,
  );

  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const parsed = productSchema.safeParse(req.body);

  if (!Number.isInteger(id) || !parsed.success) {
    return res.status(400).json({ error: 'Invalid product update' });
  }

  const x = parsed.data;
  const result = db.prepare(`
    UPDATE products
    SET name=?, category=?, description=?, price=?, stock=?, image_url=?, available=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    x.name,
    x.category,
    x.description,
    x.price,
    x.stock,
    x.image_url,
    x.available ? 1 : 0,
    id
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json({ ok: true });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(Number(req.params.id));
  res.status(204).end();
});

app.post('/api/admin/services', requireAdmin, (req, res) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid service' });

  const x = parsed.data;
  const result = db.prepare('INSERT INTO services(name,description,active) VALUES(?,?,?)').run(
    x.name,
    x.description,
    x.active ? 1 : 0,
  );

  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM services WHERE id=?').run(Number(req.params.id));
  res.status(204).end();
});

app.post('/api/admin/tool-rentals', requireAdmin, (req, res) => {
  const parsed = toolRentalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid tool rental' });

  const x = parsed.data;
  const result = db.prepare(`
    INSERT INTO tool_rentals
    (name,category,description,hourly_rate,image_url,available,active)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    x.name,
    x.category,
    x.description,
    x.hourly_rate,
    x.image_url,
    x.available ? 1 : 0,
    x.active ? 1 : 0,
  );

  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.delete('/api/admin/tool-rentals/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tool_rentals WHERE id=?').run(Number(req.params.id));
  res.status(204).end();
});

app.post('/api/admin/advertisements', requireAdmin, (req, res) => {
  const parsed = adSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid advertisement' });

  const x = parsed.data;
  const result = db.prepare('INSERT INTO advertisements(title,body,image_url,active) VALUES(?,?,?,?)').run(
    x.title,
    x.body,
    x.image_url,
    x.active ? 1 : 0,
  );

  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.delete('/api/admin/advertisements/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM advertisements WHERE id=?').run(Number(req.params.id));
  res.status(204).end();
});

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 200').all());
});

app.patch('/api/admin/messages/:id/status', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').trim();
  const allowed = ['New', 'In Progress', 'Completed'];

  if (!Number.isInteger(id) || !allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid message status.' });
  }

  const result = db.prepare('UPDATE messages SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
  if (result.changes === 0) return res.status(404).json({ error: 'Message not found.' });

  res.json({ ok: true, status });
});

app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid message ID.' });

  const result = db.prepare('DELETE FROM messages WHERE id=?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Message not found.' });

  res.status(204).end();
});

app.patch('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').trim();
  const allowed = ['Pending', 'Confirmed', 'Processing', 'Completed', 'Cancelled'];

  if (!Number.isInteger(id) || !allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid order status.' });
  }

  const result = db.prepare('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
  if (result.changes === 0) return res.status(404).json({ error: 'Order not found.' });

  res.json({ ok: true, status });
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`SCBS running at http://localhost:${PORT}`));
