import 'dotenv/config';
import express from 'express';
import { registerRentalRoutes } from './rental-routes.js';
import multer from 'multer';
import helmet from 'helmet';
import Database from 'better-sqlite3';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import SqliteStoreFactory from 'better-sqlite3-session-store';
import { ORDER_STATUSES, canTransitionOrder } from './order-workflow.js';
import { cancelOrder, initializeOrderCancellationSchema } from './order-cancellation.js';
import { isAdminRole, hasPermission } from './admin-permissions.js';
import { registerAdminTeamRoutes } from './admin-team-routes.js';
import { sendCustomerLoginEmail } from './email-notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Railway runs behind a trusted reverse proxy; needed for correct client IP and rate limiting.
app.set('trust proxy', 1);
// SCBS upload directory filesystem support
const fs = await import('node:fs/promises');

// SCBS dedicated database connection
const DATABASE_PATH = process.env.SCBS_DATABASE_PATH
  ? path.resolve(process.env.SCBS_DATABASE_PATH)
  : path.join(__dirname, 'scbs.db');
const db = new Database(DATABASE_PATH);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Initialize the order cancellation inventory-restoration schema.
initializeOrderCancellationSchema(db);
db.pragma('busy_timeout = 5000');

// Additive SCBS account-control and order-cancellation audit fields.
function ensureColumn(table, column, declaration) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.length && !columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }
}
ensureColumn('customers', 'is_disabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('customers', 'disabled_reason', 'TEXT');
ensureColumn('customers', 'disabled_at', 'TEXT');
ensureColumn('customers', 'disabled_by', 'INTEGER');
ensureColumn('orders', 'cancellation_reason', 'TEXT');
ensureColumn('orders', 'cancelled_at', 'TEXT');
ensureColumn('orders', 'cancelled_by', 'INTEGER');
ensureColumn('services', 'image_url', 'TEXT');

// SCBS customer message replies: additive, backward-compatible columns.
{
  const messageColumns = db.prepare("PRAGMA table_info(messages)").all();
  if (messageColumns.length) {
    const existing = new Set(messageColumns.map(column => column.name));
    if (!existing.has('admin_reply')) {
      db.exec("ALTER TABLE messages ADD COLUMN admin_reply TEXT");
    }
    if (!existing.has('admin_replied_at')) {
      db.exec("ALTER TABLE messages ADD COLUMN admin_replied_at TEXT");
    }
    if (!existing.has('customer_last_seen_at')) {
      db.exec("ALTER TABLE messages ADD COLUMN customer_last_seen_at TEXT");
    }
    db.exec("CREATE INDEX IF NOT EXISTS messages_customer_date_idx ON messages(customer_id, created_at DESC)");
  }
}


// SCBS POSTS: idempotent schema addition; existing tables are untouched.
db.exec(`
  CREATE TABLE IF NOT EXISTS scbs_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 150),
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
    image_url TEXT,
    is_announcement INTEGER NOT NULL DEFAULT 0 CHECK(is_announcement IN (0,1)),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','paused')),
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    published_at TEXT
  );
  CREATE INDEX IF NOT EXISTS scbs_posts_public_idx
    ON scbs_posts(status, published_at DESC, created_at DESC);

  CREATE TABLE IF NOT EXISTS scbs_issue_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
    contact TEXT NOT NULL CHECK(length(contact) BETWEEN 3 AND 254),
    category TEXT NOT NULL CHECK(category IN ('Suspicious activity','Technical problem','Order or payment','Other')),
    description TEXT NOT NULL CHECK(length(description) BETWEEN 10 AND 3000),
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','under_review','resolved')),
    admin_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS scbs_issue_reports_status_date_idx
    ON scbs_issue_reports(status, created_at DESC);
`);

// SCBS video library: stores YouTube references only, not large video files.
db.exec(`
  CREATE TABLE IF NOT EXISTS scbs_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 150),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 5000),
    category TEXT NOT NULL DEFAULT 'General' CHECK(length(category) BETWEEN 2 AND 80),
    youtube_url TEXT NOT NULL,
    youtube_video_id TEXT NOT NULL CHECK(length(youtube_video_id) = 11),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','paused')),
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    published_at TEXT
  );
  CREATE INDEX IF NOT EXISTS scbs_videos_public_idx
    ON scbs_videos(status, published_at DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS scbs_videos_category_idx
    ON scbs_videos(category, status);
`);


const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
// SCBS book-cover upload configuration
const BOOK_COVER_DIR = path.join(
  __dirname,
  'public',
  'uploads',
  'book-covers'
);

const BOOK_COVER_MAX_BYTES = 2 * 1024 * 1024;

const BOOK_COVER_TYPES = new Map([
  ['image/jpeg', { extension: '.jpg', signature: [0xff, 0xd8, 0xff] }],
  ['image/png', {
    extension: '.png',
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  }],
  ['image/webp', {
    extension: '.webp',
    signature: [0x52, 0x49, 0x46, 0x46],
    extraSignature: [0x57, 0x45, 0x42, 0x50]
  }]
]);

const RENTAL_IMAGE_DIR = path.join(
  __dirname,
  'public',
  'uploads',
  'rental-tools'
);

const RENTAL_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const RENTAL_IMAGE_TYPES = new Map([
  ['image/jpeg', {
    extension: '.jpg',
    signature: [0xff, 0xd8, 0xff]
  }],
  ['image/png', {
    extension: '.png',
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  }],
  ['image/webp', {
    extension: '.webp',
    signature: [0x52, 0x49, 0x46, 0x46],
    extraSignature: [0x57, 0x45, 0x42, 0x50]
  }]
]);

const rentalImageStorage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, RENTAL_IMAGE_DIR);
  },
  filename: (_req, file, callback) => {
    const type = RENTAL_IMAGE_TYPES.get(file.mimetype);

    if (!type) {
      return callback(new Error('Unsupported rental image format.'));
    }

    callback(null, `${randomUUID()}${type.extension}`);
  }
});

const rentalImageUpload = multer({
  storage: rentalImageStorage,
  limits: {
    fileSize: RENTAL_IMAGE_MAX_BYTES,
    files: 1,
    fields: 0,
    parts: 1
  },
  fileFilter: (_req, file, callback) => {
    if (!RENTAL_IMAGE_TYPES.has(file.mimetype)) {
      return callback(
        new Error('Only JPEG, PNG, and WebP rental pictures are allowed.')
      );
    }

    callback(null, true);
  }
});

const bookCoverStorage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, BOOK_COVER_DIR);
  },
  filename: (_req, file, callback) => {
    const type = BOOK_COVER_TYPES.get(file.mimetype);

    if (!type) {
      return callback(new Error('Unsupported book-cover image format.'));
    }

    callback(null, `${randomUUID()}${type.extension}`);
  }
});

const bookCoverUpload = multer({
  storage: bookCoverStorage,
  limits: {
    fileSize: BOOK_COVER_MAX_BYTES,
    files: 1,
    fields: 5,
    parts: 6
  },
  fileFilter: (_req, file, callback) => {
    if (!BOOK_COVER_TYPES.has(file.mimetype)) {
      return callback(
        new Error('Only JPEG, PNG, and WebP book covers are allowed.')
      );
    }

    callback(null, true);
  }
});// ============================================
// SCBS CUSTOMER PROFILE-PICTURE UPLOAD
// ============================================
const CUSTOMER_PROFILE_DIR = path.join(
  __dirname,
  'public',
  'uploads',
  'customer-profiles'
);

const CUSTOMER_PROFILE_MAX_BYTES = 2 * 1024 * 1024;

const CUSTOMER_PROFILE_TYPES = new Map([
  ['image/jpeg', {
    extension: '.jpg',
    signature: [0xff, 0xd8, 0xff]
  }],
  ['image/png', {
    extension: '.png',
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  }],
  ['image/webp', {
    extension: '.webp',
    signature: [0x52, 0x49, 0x46, 0x46],
    extraSignature: [0x57, 0x45, 0x42, 0x50]
  }]
]);

const customerProfileStorage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, CUSTOMER_PROFILE_DIR);
  },
  filename: (_req, file, callback) => {
    const type = CUSTOMER_PROFILE_TYPES.get(file.mimetype);

    if (!type) {
      return callback(
        new Error('Unsupported profile-picture format.')
      );
    }

    callback(null, `${randomUUID()}${type.extension}`);
  }
});

const customerProfileUpload = multer({
  storage: customerProfileStorage,
  limits: {
    fileSize: CUSTOMER_PROFILE_MAX_BYTES,
    files: 1,
    fields: 0,
    parts: 1
  },
  fileFilter: (_req, file, callback) => {
    if (!CUSTOMER_PROFILE_TYPES.has(file.mimetype)) {
      return callback(
        new Error('Only JPEG, PNG, and WebP profile pictures are allowed.')
      );
    }

    callback(null, true);
  }
});// Ensure SCBS upload directories exist before accepting uploads.

await fs.mkdir(BOOK_COVER_DIR, { recursive: true });
await fs.mkdir(CUSTOMER_PROFILE_DIR, { recursive: true });
await fs.mkdir(RENTAL_IMAGE_DIR, { recursive: true });

// SCBS multi-tech service images: same safe image formats and size limit as rentals.
const SERVICE_IMAGE_DIR = path.join(__dirname, 'public', 'uploads', 'service-images');
const SERVICE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const SERVICE_IMAGE_TYPES = new Map([
  ['image/jpeg', { extension: '.jpg', signature: [0xff, 0xd8, 0xff] }],
  ['image/png', { extension: '.png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  ['image/webp', { extension: '.webp', signature: [0x52, 0x49, 0x46, 0x46], extraSignature: [0x57, 0x45, 0x42, 0x50] }]
]);
const serviceImageStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, SERVICE_IMAGE_DIR),
  filename: (_req, file, callback) => {
    const type = SERVICE_IMAGE_TYPES.get(file.mimetype);
    if (!type) return callback(new Error('Unsupported service image format.'));
    callback(null, `${randomUUID()}${type.extension}`);
  }
});
const serviceImageUpload = multer({
  storage: serviceImageStorage,
  limits: { fileSize: SERVICE_IMAGE_MAX_BYTES, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, callback) => {
    if (!SERVICE_IMAGE_TYPES.has(file.mimetype)) {
      return callback(new Error('Only JPEG, PNG, and WebP service images are allowed.'));
    }
    callback(null, true);
  }
});
await fs.mkdir(SERVICE_IMAGE_DIR, { recursive: true });


// SCBS advertisement image uploads (admin-only, JPEG/PNG/WebP, max 2 MB).
const ADVERTISEMENT_IMAGE_DIR = path.join(__dirname, 'public', 'uploads', 'advertisement-images');
const ADVERTISEMENT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const ADVERTISEMENT_IMAGE_TYPES = new Map([
  ['image/jpeg', { extension: '.jpg', signature: [0xff, 0xd8, 0xff] }],
  ['image/png', { extension: '.png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  ['image/webp', { extension: '.webp', signature: [0x52, 0x49, 0x46, 0x46], extraSignature: [0x57, 0x45, 0x42, 0x50] }]
]);
const advertisementImageStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, ADVERTISEMENT_IMAGE_DIR),
  filename: (_req, file, callback) => {
    const type = ADVERTISEMENT_IMAGE_TYPES.get(file.mimetype);
    if (!type) return callback(new Error('Unsupported advertisement image format.'));
    callback(null, `${randomUUID()}${type.extension}`);
  }
});
const advertisementImageUpload = multer({
  storage: advertisementImageStorage,
  limits: { fileSize: ADVERTISEMENT_IMAGE_MAX_BYTES, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ADVERTISEMENT_IMAGE_TYPES.has(file.mimetype)) {
      return callback(new Error('Only JPEG, PNG, and WebP advertisement images are allowed.'));
    }
    callback(null, true);
  }
});
await fs.mkdir(ADVERTISEMENT_IMAGE_DIR, { recursive: true });


if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be configured in production.');
}

app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", 'data:', 'https:'],
        frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com']
      }
    }
  })
);app.use(express.json({ limit: '100kb' }));
// SCBS API-wide rate limit: do not count static HTML/CSS/JS/images against the API quota.
// Return JSON for 429 responses so the browser's response.json() handlers do not fail on plain text.
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'SCBS received too many API requests from this connection. Wait a few minutes, then retry.'
  }
}));
// SCBS secure administrator sessions
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters.');
}

const SqliteStore = SqliteStoreFactory(session);

app.use(session({
  name: 'scbs.sid',
  store: new SqliteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: 15 * 60 * 1000
    }
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 30 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, 'public')));
// ============================================
// SCBS ADMIN AUTHENTICATION
// ============================================

const customerMessageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many messages. Please wait before trying again.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login attempts. Please try again later.'
  }
});

function requireAdmin(req, res, next) {
  if (!req.session?.adminId) {
    return res.status(401).json({
      success: false,
      error: 'Please sign in as an administrator.'
    });
  }

  try {
    const admin = db.prepare(`
      SELECT id, role
      FROM admins
      WHERE id = ? AND is_active = 1
    `).get(req.session.adminId);

    if (!admin || !isAdminRole(admin.role)) {
      delete req.session.adminId;
      return req.session.save(() => res.status(401).json({
        success: false,
        error: 'Your administrator session is no longer valid.'
      }));
    }

    req.admin = admin;
    next();
  } catch (error) {
    console.error('SCBS administrator authorisation failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to verify administrator permissions.'
    });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.admin || !hasPermission(req.admin.role, permission)) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to perform this action.'
      });
    }

    next();
  };
}

function requireOwner(req, res, next) {
  return requirePermission('team:write')(req, res, next);
}
registerAdminTeamRoutes({
  app,
  db,
  bcrypt,
  requireAdmin,
  requirePermission,
  requireOwner
});

// Check whether an administrator is signed in.
app.get('/api/auth/me', (req, res) => {
  if (!req.session?.adminId) {
    return res.json({
      authenticated: false,
      admin: null
    });
  }

  try {
    const admin = db.prepare(`
      SELECT id, email, display_name, role
      FROM admins
      WHERE id = ? AND is_active = 1
    `).get(req.session.adminId);

    if (!admin) {
      delete req.session.adminId;
      return req.session.save(() => res.json({
        authenticated: false,
        admin: null
      }));
    }

    res.json({
      authenticated: true,
      admin
    });
  } catch (error) {
    console.error('SCBS authentication check failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Unable to check administrator login.'
    });
  }
});

// Sign in an administrator.
app.post('/api/auth/login', loginLimiter, (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

    const password = typeof req.body?.password === 'string'
      ? req.body.password
      : '';

    if (!email || !password || password.length > 1024) {
      return res.status(400).json({
        success: false,
        error: 'Enter your email and password.'
      });
    }

    const admin = db.prepare(`
      SELECT id, email, password_hash, display_name, role
      FROM admins
      WHERE email = ? AND is_active = 1
    `).get(email);

    // Use the same public error for unknown emails and wrong passwords.
    const passwordHash = admin?.password_hash ||
      '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6Gf8YvLqJ0mKQJj7l5N9n5xvQe6yK';

    bcrypt.compare(password, passwordHash, (error, matched) => {
      if (error) return next(error);

      if (!admin || !matched) {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password.'
        });
      }

      // Keep an already-authenticated customer session when the owner signs in
      // in the same browser. Session ID is still regenerated to prevent fixation.
      const existingCustomerId = req.session?.customerId;
      req.session.regenerate((sessionError) => {
        if (sessionError) return next(sessionError);

        if (existingCustomerId) req.session.customerId = existingCustomerId;
        req.session.adminId = admin.id;

        req.session.save((saveError) => {
          if (saveError) return next(saveError);

          db.prepare(`
            UPDATE admins
            SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?
          `).run(admin.id);

          res.json({
            success: true,
            message: 'Signed in successfully.',
            admin: {
              id: admin.id,
              email: admin.email,
              display_name: admin.display_name,
              role: admin.role
            }
          });
        });
      });
    });
  } catch (error) {
    next(error);
  }
});

// Sign out the current administrator.
app.post('/api/auth/logout', (req, res, next) => {
  if (!req.session) {
    return res.json({ success: true });
  }

  delete req.session.adminId;
  req.session.save((error) => {
    if (error) return next(error);

    // Keep the shared session cookie if a customer remains signed in.
    if (!req.session.customerId) {
      req.session.destroy((destroyError) => {
        if (destroyError) return next(destroyError);
        res.clearCookie('scbs.sid', {
          httpOnly: true,
          sameSite: 'lax',
          secure: isProduction
        });
        return res.json({ success: true, message: 'Signed out successfully.' });
      });
      return;
    }

    res.json({ success: true, message: 'Administrator signed out successfully.' });
  });
});

// ============================================
// ============================================
// SCBS CUSTOMER AUTHENTICATION
// ============================================

const customerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many customer login attempts. Please try again later.'
  }
});

const customerRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many registration attempts. Please try again later.'
  }
});

function requireCustomer(req, res, next) {
  if (!req.session?.customerId) {
    return res.status(401).json({
      success: false,
      error: 'Please sign in to your customer account.'
    });
  }

  try {
    const customer = db.prepare(`
      SELECT id, customer_code, full_name, email, phone, status,
       profile_picture_url
      FROM customers
      WHERE id = ? AND status = 'active' AND COALESCE(is_disabled, 0) = 0
    `).get(req.session.customerId);

    if (!customer) {
      delete req.session.customerId;
      return req.session.save(() => res.status(401).json({
        success: false,
        error: 'Your customer session is no longer valid.'
      }));
    }

    req.customer = customer;
    next();
  } catch (error) {
    console.error('SCBS customer authorisation failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Unable to verify your customer account.'
    });
  }
}

// Register a new customer.
app.post(
  '/api/customer/register',
  customerRegisterLimiter,
  (req, res, next) => {
    try {
      const fullName = typeof req.body?.full_name === 'string'
        ? req.body.full_name.trim()
        : '';

      const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';

      const phone = typeof req.body?.phone === 'string'
        ? req.body.phone.trim()
        : '';

      const password = typeof req.body?.password === 'string'
        ? req.body.password
        : '';

      if (fullName.length < 2 || fullName.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Enter a name between 2 and 100 characters.'
        });
      }

      if (
        !email ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Enter a valid email address.'
        });
      }

      if (phone.length < 7 || phone.length > 25) {
        return res.status(400).json({
          success: false,
          error: 'Enter a valid phone number.'
        });
      }

      if (password.length < 12 || password.length > 72) {
        return res.status(400).json({
          success: false,
          error: 'Your password must contain 12 to 72 characters.'
        });
      }

      const existing = db.prepare(`
        SELECT id
        FROM customers
        WHERE email = ? COLLATE NOCASE OR phone = ?
        LIMIT 1
      `).get(email, phone);

      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'An account with that email or phone number already exists.'
        });
      }

      const passwordHash = bcrypt.hashSync(password, 12);
      const customerCode = `SC${Date.now().toString(36).toUpperCase()}${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;

      const result = db.prepare(`
        INSERT INTO customers (
          customer_code,
          full_name,
          email,
          phone,
          password_hash
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        customerCode,
        fullName,
        email,
        phone,
        passwordHash
      );

      const customerId = Number(result.lastInsertRowid);

      req.session.regenerate((sessionError) => {
        if (sessionError) return next(sessionError);

        req.session.customerId = customerId;

        req.session.save((saveError) => {
          if (saveError) return next(saveError);

          res.status(201).json({
            success: true,
            message: 'Customer account created successfully.',
            customer: {
              id: customerId,
              customer_code: customerCode,
              full_name: fullName,
              email,
              phone
            }
          });
        });
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({
          success: false,
          error: 'That customer account already exists.'
        });
      }

      next(error);
    }
  }
);

// Sign in a customer.
app.post('/api/customer/login', customerLoginLimiter, (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

    const password = typeof req.body?.password === 'string'
      ? req.body.password
      : '';

    if (!email || !password || password.length > 72) {
      return res.status(400).json({
        success: false,
        error: 'Enter your email and password.'
      });
    }

    const customer = db.prepare(`
      SELECT id, customer_code, full_name, email, phone, password_hash
      FROM customers
      WHERE email = ? COLLATE NOCASE
        AND status = 'active'
        AND COALESCE(is_disabled, 0) = 0
      LIMIT 1
    `).get(email);

    if (!customer?.password_hash) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    bcrypt.compare(password, customer.password_hash, (error, matched) => {
      if (error) return next(error);

      if (!matched) {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password.'
        });
      }

      // Keep an already-authenticated owner session when a customer signs in
      // in the same browser. Session ID is still regenerated to prevent fixation.
      const existingAdminId = req.session?.adminId;
      req.session.regenerate((sessionError) => {
        if (sessionError) return next(sessionError);

        if (existingAdminId) req.session.adminId = existingAdminId;
        req.session.customerId = customer.id;

        req.session.save((saveError) => {
          if (saveError) return next(saveError);

          // Send the notification without delaying or blocking customer login.
          void sendCustomerLoginEmail({
            email: customer.email,
            full_name: customer.full_name
          }).catch((error) => {
            console.error('[SCBS email] Unexpected notification error:', error.message);
          });

          res.json({
            success: true,
            message: 'Signed in successfully.',
            customer: {
              id: customer.id,
              customer_code: customer.customer_code,
              full_name: customer.full_name,
              email: customer.email,
              phone: customer.phone
            }
          });
        });
      });
    });
  } catch (error) {
    next(error);
  }
});
// SCBS CUSTOMER SETTINGS: ensure country column exists.
const customerColumns = db.prepare(
  "PRAGMA table_info(customers)"
).all();

if (!customerColumns.some(column => column.name === "country")) {
  db.exec(`
    ALTER TABLE customers
    ADD COLUMN country TEXT NOT NULL DEFAULT 'Zambia'
  `);
}

// Update the signed-in customer's profile settings.
app.patch('/api/customer/settings/profile', requireCustomer, (req, res) => {
  try {
    const fullName = typeof req.body.full_name === 'string'
      ? req.body.full_name.trim()
      : '';

    const phone = typeof req.body.phone === 'string'
      ? req.body.phone.trim()
      : '';

    const country = typeof req.body.country === 'string'
      ? req.body.country.trim()
      : '';

    const allowedCountries = [
      'Zambia',
      'Zimbabwe',
      'Malawi',
      'Tanzania',
      'South Africa',
      'Botswana',
      'Namibia',
      'Democratic Republic of the Congo',
      'Other'
    ];

    if (fullName.length < 2 || fullName.length > 150) {
      return res.status(400).json({
        success: false,
        error: 'Full name must contain 2–150 characters.'
      });
    }

    if (phone.length > 30 ||
        (phone !== '' && !/^[+0-9()\s-]+$/.test(phone))) {
      return res.status(400).json({
        success: false,
        error: 'Enter a valid phone number or leave it empty.'
      });
    }

    if (!allowedCountries.includes(country)) {
      return res.status(400).json({
        success: false,
        error: 'Select a supported country.'
      });
    }

    db.prepare(`
      UPDATE customers
      SET full_name = ?,
          phone = ?,
          country = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status = 'active'
    `).run(fullName, phone, country, req.customer.id);

    const customer = db.prepare(`
      SELECT id, customer_code, full_name, email, phone,
             country, status, profile_picture_url
      FROM customers
      WHERE id = ? AND status = 'active'
    `).get(req.customer.id);

    req.customer = customer;

    return res.json({
      success: true,
      message: 'Your profile settings have been saved.',
      customer
    });
  } catch (error) {
    console.error('Customer settings update failed:', error.message);

    return res.status(500).json({
      success: false,
      error: 'Unable to save your profile settings.'
    });
  }
});
// SCBS CUSTOMER SETTINGS: securely change password.
app.post(
  '/api/customer/settings/password',
  requireCustomer,
  async (req, res) => {
    try {
      const currentPassword = req.body?.current_password;
      const newPassword = req.body?.new_password;
      const confirmPassword = req.body?.confirm_password;

      if (
        typeof currentPassword !== 'string' ||
        typeof newPassword !== 'string' ||
        typeof confirmPassword !== 'string'
      ) {
        return res.status(400).json({
          success: false,
          error: 'Complete all password fields.'
        });
      }

      if (
        newPassword.length < 12 ||
        newPassword.length > 128
      ) {
        return res.status(400).json({
          success: false,
          error: 'Your new password must contain 12–128 characters.'
        });
      }

      if (newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          error: 'The new passwords do not match.'
        });
      }

      if (currentPassword === newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Choose a password different from your current password.'
        });
      }

      const customer = db.prepare(`
        SELECT id, password_hash
        FROM customers
        WHERE id = ? AND status = 'active'
        LIMIT 1
      `).get(req.customer.id);

      if (!customer || !customer.password_hash) {
        return res.status(400).json({
          success: false,
          error: 'Unable to verify this customer account.'
        });
      }

      const passwordMatches = await bcrypt.compare(
        currentPassword,
        customer.password_hash
      );

      if (!passwordMatches) {
        return res.status(401).json({
          success: false,
          error: 'Your current password is incorrect.'
        });
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      db.prepare(`
        UPDATE customers
        SET password_hash = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'active'
      `).run(newPasswordHash, customer.id);

      return res.json({
        success: true,
        message: 'Your password has been changed successfully.'
      });
    } catch (error) {
      console.error('Customer password change failed:', error.message);

      return res.status(500).json({
        success: false,
        error: 'Unable to change your password right now.'
      });
    }
  }
);

// Return the signed-in customer's profile.
app.get('/api/customer/me', requireCustomer, (req, res) => {
  res.json({
    success: true,
    customer: req.customer
  });
});

// Sign out the current customer.
app.post('/api/customer/logout', (req, res, next) => {
  if (!req.session) {
    return res.json({ success: true });
  }

  delete req.session.customerId;
  req.session.save((error) => {
    if (error) return next(error);

    // Keep the shared session cookie if an administrator remains signed in.
    if (!req.session.adminId) {
      req.session.destroy((destroyError) => {
        if (destroyError) return next(destroyError);
        res.clearCookie('scbs.sid', {
          httpOnly: true,
          sameSite: 'lax',
          secure: isProduction
        });
        return res.json({ success: true, message: 'Signed out successfully.' });
      });
      return;
    }

    res.json({ success: true, message: 'Customer signed out successfully.' });
  });
});

// ============================================
// END SCBS CUSTOMER AUTHENTICATION
// ============================================
// SCBS CUSTOMER DELIVERY ADDRESSES
// ============================================

// Retrieve addresses belonging to the signed-in customer.
app.get('/api/customer/addresses', requireCustomer, (req, res) => {
  try {
    const addresses = db.prepare(`
      SELECT
        id,
        address_label,
        country,
        province,
        city,
        district,
        area,
        street,
        house_number,
        building_flat,
        landmark,
        delivery_instructions,
        is_default,
        created_at,
        updated_at
      FROM customer_addresses
      WHERE customer_id = ?
      ORDER BY is_default DESC, id DESC
    `).all(req.customer.id);

    res.json({
      success: true,
      addresses
    });
  } catch (error) {
    console.error('SCBS customer addresses retrieval failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Unable to retrieve delivery addresses.'
    });
  }
});

// Save a delivery address for the signed-in customer.
app.post('/api/customer/addresses', requireCustomer, (req, res) => {
  try {
    const body = req.body || {};

    const fields = {
      address_label: body.address_label ?? 'Home',
      country: body.country,
      province: body.province,
      city: body.city,
      district: body.district,
      area: body.area,
      street: body.street,
      house_number: body.house_number
    };

    for (const [field, value] of Object.entries(fields)) {
      if (typeof value !== 'string' || !value.trim()) {
        return res.status(400).json({
          success: false,
          error: `Please provide ${field.replaceAll('_', ' ')}.`
        });
      }
    }

    const limits = {
      address_label: 40,
      country: 100,
      province: 100,
      city: 100,
      district: 100,
      area: 150,
      street: 150,
      house_number: 50
    };

    for (const [field, value] of Object.entries(fields)) {
      if (value.trim().length > limits[field]) {
        return res.status(400).json({
          success: false,
          error: `${field.replaceAll('_', ' ')} is too long.`
        });
      }
    }

    const optionalFields = [
      'building_flat',
      'landmark',
      'delivery_instructions'
    ];

    const optional = {};

    for (const field of optionalFields) {
      const value = body[field] ?? '';

      if (typeof value !== 'string' || value.length > 300) {
        return res.status(400).json({
          success: false,
          error: `${field.replaceAll('_', ' ')} must be 300 characters or fewer.`
        });
      }

      optional[field] = value.trim();
    }

    if (
      body.is_default !== undefined &&
      ![true, false, 0, 1].includes(body.is_default)
    ) {
      return res.status(400).json({
        success: false,
        error: 'is_default must be true or false.'
      });
    }

    const isDefault = body.is_default === true || body.is_default === 1;

    const saveAddress = db.transaction(() => {
      if (isDefault) {
        db.prepare(`
          UPDATE customer_addresses
          SET is_default = 0,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE customer_id = ?
        `).run(req.customer.id);
      }

      const existingCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM customer_addresses
        WHERE customer_id = ?
      `).get(req.customer.id).count;

      const result = db.prepare(`
        INSERT INTO customer_addresses (
          customer_id,
          address_label,
          country,
          province,
          city,
          district,
          area,
          street,
          house_number,
          building_flat,
          landmark,
          delivery_instructions,
          is_default
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.customer.id,
        fields.address_label.trim(),
        fields.country.trim(),
        fields.province.trim(),
        fields.city.trim(),
        fields.district.trim(),
        fields.area.trim(),
        fields.street.trim(),
        fields.house_number.trim(),
        optional.building_flat,
        optional.landmark,
        optional.delivery_instructions,
        isDefault || existingCount === 0 ? 1 : 0
      );

      return Number(result.lastInsertRowid);
    });

    const addressId = saveAddress();

    const address = db.prepare(`
      SELECT
        id,
        address_label,
        country,
        province,
        city,
        district,
        area,
        street,
        house_number,
        building_flat,
        landmark,
        delivery_instructions,
        is_default,
        created_at,
        updated_at
      FROM customer_addresses
      WHERE id = ? AND customer_id = ?
    `).get(addressId, req.customer.id);

    res.status(201).json({
      success: true,
      message: 'Delivery address saved successfully.',
      address
    });
  } catch (error) {
    console.error('SCBS customer address save failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Unable to save the delivery address.'
    });
  }
});

// ============================================
// END SCBS CUSTOMER DELIVERY ADDRESSES
// ============================================
// ============================================
// SCBS CUSTOMER CHECKOUT API
// ============================================

// Create an order with a verified delivery address.
app.post('/api/customer/orders', requireCustomer, (req, res, next) => {
  try {
    const { address_id, items, customer_notes } = req.body || {};

    if (!Number.isSafeInteger(address_id) || address_id < 1) {
      return res.status(400).json({
        success: false,
        error: 'Select a valid delivery address.'
      });
    }

    if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'Provide between 1 and 50 order items.'
      });
    }

    if (
      customer_notes !== undefined &&
      (typeof customer_notes !== 'string' || customer_notes.length > 1000)
    ) {
      return res.status(400).json({
        success: false,
        error: 'Order notes must be 1000 characters or fewer.'
      });
    }

    const address = db.prepare(`
      SELECT *
      FROM customer_addresses
      WHERE id = ? AND customer_id = ?
    `).get(address_id, req.customer.id);

    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'That delivery address does not belong to your account.'
      });
    }

    const normalizedItems = [];
    const seenItems = new Set();

    for (const item of items) {
      const type = item?.type;
      const id = item?.id;
      const quantity = item?.quantity;

      if (
        !['product', 'book'].includes(type) ||
        !Number.isSafeInteger(id) ||
        id < 1 ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 100
      ) {
        return res.status(400).json({
          success: false,
          error: 'Each item needs a valid type, ID, and quantity.'
        });
      }

      const itemKey = `${type}:${id}`;

      if (seenItems.has(itemKey)) {
        return res.status(400).json({
          success: false,
          error: 'Do not submit the same item more than once.'
        });
      }

      seenItems.add(itemKey);
      normalizedItems.push({ type, id, quantity });
    }

    const createOrder = db.transaction(() => {
      const orderItems = [];
      let subtotal = 0;

      for (const item of normalizedItems) {
        let record;

        if (item.type === 'product') {
          record = db.prepare(`
            SELECT id, name, price_ngwee, stock_quantity
            FROM products
            WHERE id = ? AND is_active = 1
          `).get(item.id);
        } else {
          record = db.prepare(`
            SELECT id, title AS name, price_ngwee, stock_quantity
            FROM books
            WHERE id = ? AND publication_status = 'published'
          `).get(item.id);
        }

        if (!record) {
          throw new Error('An item is unavailable. Please refresh your cart.');
        }

        if (
          !Number.isSafeInteger(record.price_ngwee) ||
          record.price_ngwee < 0
        ) {
          throw new Error('An item has an invalid price. Please contact SCBS.');
        }

        if (record.stock_quantity < item.quantity) {
          throw new Error(`Insufficient stock for ${record.name}.`);
        }

        const lineTotal = record.price_ngwee * item.quantity;

        if (!Number.isSafeInteger(lineTotal)) {
          throw new Error('Order total is too large.');
        }

        subtotal += lineTotal;

        if (!Number.isSafeInteger(subtotal)) {
          throw new Error('Order total is too large.');
        }

        orderItems.push({
          ...item,
          name: record.name,
          unitPrice: record.price_ngwee,
          lineTotal
        });
      }

              // SCBS STOCK PROTECTION
        // Deduct stock inside the order transaction.
        for (const item of orderItems) {
          let stockUpdate;

          if (item.type === 'product') {
            stockUpdate = db.prepare(`
              UPDATE products
              SET stock_quantity = stock_quantity - ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id = ?
                AND is_active = 1
                AND stock_quantity >= ?
            `).run(item.quantity, item.id, item.quantity);
          } else if (item.type === 'book') {
            stockUpdate = db.prepare(`
              UPDATE books
              SET stock_quantity = stock_quantity - ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE id = ?
                AND publication_status = 'published'
                AND stock_quantity >= ?
            `).run(item.quantity, item.id, item.quantity);
          }

          if (!stockUpdate || stockUpdate.changes !== 1) {
            throw new Error(
              `Insufficient stock for ${item.name}. Please refresh your cart.`
            );
          }
        }
const orderNumber =
        `SCBS-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

      const orderResult = db.prepare(`
        INSERT INTO orders (
          order_number,
          customer_id,
          status,
          currency,
          subtotal_ngwee,
          discount_ngwee,
          total_ngwee,
          customer_notes
        )
        VALUES (?, ?, 'pending', 'ZMW', ?, 0, ?, ?)
      `).run(
        orderNumber,
        req.customer.id,
        subtotal,
        subtotal,
        (customer_notes || '').trim()
      );

      const orderId = Number(orderResult.lastInsertRowid);

      const insertItem = db.prepare(`
        INSERT INTO order_items (
          order_id,
          product_id,
          book_id,
          item_name,
          quantity,
          unit_price_ngwee,
          line_total_ngwee
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of orderItems) {
        insertItem.run(
          orderId,
          item.type === 'product' ? item.id : null,
          item.type === 'book' ? item.id : null,
          item.name,
          item.quantity,
          item.unitPrice,
          item.lineTotal
        );
      }

      db.prepare(`
        INSERT INTO order_delivery_addresses (
          order_id,
          customer_address_id,
          recipient_name,
          recipient_phone,
          country,
          province,
          city,
          district,
          area,
          street,
          house_number,
          building_flat,
          landmark,
          delivery_instructions
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId,
        address.id,
        req.customer.full_name,
        req.customer.phone,
        address.country,
        address.province,
        address.city,
        address.district,
        address.area,
        address.street,
        address.house_number,
        address.building_flat,
        address.landmark,
        address.delivery_instructions
      );

      return {
        id: orderId,
        order_number: orderNumber,
        status: 'pending',
        currency: 'ZMW',
        subtotal_ngwee: subtotal,
        total_ngwee: subtotal,
        items: orderItems.length
      };
    });

    const order = createOrder();

    res.status(201).json({
      success: true,
      message: 'Order submitted successfully.',
      order
    });
  } catch (error) {
    if (
      error.message.startsWith('An item is unavailable') ||
      error.message.startsWith('Insufficient stock') ||
      error.message.startsWith('An item has an invalid price') ||
      error.message === 'Order total is too large.'
    ) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    next(error);
  }
});

// ============================================
// END SCBS CUSTOMER CHECKOUT API
// ============================================

// ============================================
// SCBS CUSTOMER ORDER HISTORY API
// ============================================

app.get('/api/customer/orders', requireCustomer, (req, res, next) => {
  try {
    const orders = db.prepare(`
      SELECT
        o.id,
        o.order_number,
        o.status,
        o.currency,
        o.subtotal_ngwee,
        o.discount_ngwee,
        o.total_ngwee,
        o.customer_notes,
        o.created_at,
        o.updated_at,
        d.recipient_name,
        d.recipient_phone,
        d.country,
        d.province,
        d.city,
        d.district,
        d.area,
        d.street,
        d.house_number,
        d.building_flat,
        d.landmark,
        d.delivery_instructions,
        d.delivery_status
      FROM orders o
      LEFT JOIN order_delivery_addresses d
        ON d.order_id = o.id
      WHERE o.customer_id = ?
      ORDER BY o.created_at DESC, o.id DESC
    `).all(req.customer.id);

    const getItems = db.prepare(`
      SELECT
        id,
        item_name,
        quantity,
        unit_price_ngwee,
        line_total_ngwee
      FROM order_items
      WHERE order_id = ?
      ORDER BY id ASC
    `);

    const result = orders.map(order => ({
      ...order,
      items: getItems.all(order.id)
    }));

    res.json({
      success: true,
      count: result.length,
      orders: result
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// END SCBS CUSTOMER ORDER HISTORY API
// ============================================

// ============================================
// SCBS CUSTOMER ORDER CHANGE / CANCELLATION API
// ============================================

// Submit a request to change or cancel an order.
app.post('/api/customer/orders/:id/change-requests', requireCustomer, (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const body = req.body || {};

    const requestType = String(body.request_type || '').trim().toLowerCase();
    const customerMessage = String(body.customer_message || '').trim();

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order ID.'
      });
    }

    if (!['change', 'cancellation'].includes(requestType)) {
      return res.status(400).json({
        success: false,
        error: 'Request type must be change or cancel.'
      });
    }

    if (customerMessage.length < 5 || customerMessage.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a message between 5 and 1000 characters.'
      });
    }

    const order = db.prepare(`
      SELECT id, order_number, status
      FROM orders
      WHERE id = ? AND customer_id = ?
    `).get(orderId, req.customer.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found.'
      });
    }

    const unavailableStatuses = new Set([
      'cancelled',
      'canceled',
      'delivered',
      'completed',
      'refunded'
    ]);

    if (unavailableStatuses.has(String(order.status).trim().toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: 'This order status does not allow a new change or cancellation request.'
      });
    }

    const existingRequest = db.prepare(`
      SELECT id
      FROM order_change_requests
      WHERE order_id = ?
        AND customer_id = ?
        AND status = 'pending'
      LIMIT 1
    `).get(orderId, req.customer.id);

    if (existingRequest) {
      return res.status(409).json({
        success: false,
        error: 'This order already has a pending request. Please wait for the owner to review it.'
      });
    }

    const referenceCode =
      'SCBS-REQ-' +
      Date.now().toString(36).toUpperCase() +
      '-' +
      randomBytes(3).toString('hex').toUpperCase();

    const result = db.prepare(`
      INSERT INTO order_change_requests (
        reference_code,
        order_id,
        customer_id,
        request_type,
        customer_message,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(
      referenceCode,
      orderId,
      req.customer.id,
      requestType,
      customerMessage
    );

    res.status(201).json({
      success: true,
      message: 'Your request has been submitted for owner review.',
      request: {
        id: Number(result.lastInsertRowid),
        reference_code: referenceCode,
        order_id: orderId,
        order_number: order.order_number,
        request_type: requestType,
        status: 'pending'
      }
    });
  } catch (error) {
    next(error);
  }
});

// List requests belonging only to the signed-in customer.
app.get('/api/customer/order-change-requests', requireCustomer, (req, res, next) => {
  try {
    const requests = db.prepare(`
      SELECT
        r.id,
        r.reference_code,
        r.order_id,
        o.order_number,
        r.request_type,
        r.customer_message,
        r.status,
        r.admin_response,
        r.created_at,
        r.reviewed_at
      FROM order_change_requests r
      INNER JOIN orders o ON o.id = r.order_id
      WHERE r.customer_id = ?
      ORDER BY r.created_at DESC, r.id DESC
    `).all(req.customer.id);

    res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// END SCBS CUSTOMER ORDER CHANGE / CANCELLATION API
// ============================================

// ============================================
// SCBS OWNER ORDER CHANGE REQUEST MANAGEMENT API
// ============================================

// List customer order-change and cancellation requests.
app.get('/api/admin/order-change-requests', requireAdmin, requirePermission('orders:read'), (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();

    if (status && !['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request status.'
      });
    }

    const requests = db.prepare(`
      SELECT
        r.id,
        r.reference_code,
        r.order_id,
        o.order_number,
        o.status AS order_status,
        r.customer_id,
        c.customer_code,
        c.full_name AS customer_name,
        c.email AS customer_email,
        c.phone AS customer_phone,
        r.request_type,
        r.customer_message,
        r.status AS request_status,
        r.admin_response,
        r.created_at,
        r.reviewed_by,
        r.reviewed_at
      FROM order_change_requests r
      INNER JOIN orders o ON o.id = r.order_id
      INNER JOIN customers c ON c.id = r.customer_id
      WHERE (? = '' OR r.status = ?)
      ORDER BY
        CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
        r.created_at DESC,
        r.id DESC
    `).all(status, status);

    res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    next(error);
  }
});

// Review a pending customer request.
app.patch('/api/admin/order-change-requests/:id/review', requireAdmin, requirePermission('orders:write'), (req, res, next) => {
  try {
    const requestId = Number(req.params.id);
    const body = req.body || {};

    const decision = String(body.decision || '').trim().toLowerCase();
    const adminResponse = String(body.admin_response || '').trim();

    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request ID.'
      });
    }

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        error: 'Decision must be approved or rejected.'
      });
    }

    if (adminResponse.length < 3 || adminResponse.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a response between 3 and 1000 characters.'
      });
    }

    const reviewRequest = db.transaction(() => {
      const request = db.prepare(`
        SELECT id, reference_code, order_id, request_type, status
        FROM order_change_requests
        WHERE id = ?
      `).get(requestId);

      if (!request) {
        return {
          error: 'Request not found.',
          statusCode: 404
        };
      }

      if (request.status !== 'pending') {
        return {
          error: 'This request has already been reviewed.',
          statusCode: 409
        };
      }

      let cancellationResult = null;

      if (decision === 'approved' && request.request_type === 'cancellation') {
        cancellationResult = cancelOrder(db, {
          orderId: request.order_id,
          adminId: req.admin.id,
          ipAddress: req.ip,
          source: 'customer_request'
        });

        if (!cancellationResult.success) {
          return {
            error: cancellationResult.error,
            statusCode: cancellationResult.statusCode || 409
          };
        }
      }

      const updateResult = db.prepare(`
        UPDATE order_change_requests
        SET
          status = ?,
          admin_response = ?,
          reviewed_by = ?,
          reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'pending'
      `).run(
        decision,
        adminResponse,
        req.admin.id,
        requestId
      );

      if (updateResult.changes !== 1) {
        throw new Error('The request could not be updated safely.');
      }

      return {
        reference_code: request.reference_code,
        status: decision,
        order_cancellation: cancellationResult
          ? cancellationResult.order
          : null
      };
    });

    const result = reviewRequest();

    if (result.error) {
      return res.status(result.statusCode).json({
        success: false,
        error: result.error
      });
    }

    return res.json({
      success: true,
      message: `Request ${result.status} successfully.`,
      request: result
    });
  } catch (error) {
    next(error);
  }
});
// END SCBS OWNER ORDER CHANGE REQUEST MANAGEMENT API
// ============================================

// ============================================
// SCBS OWNER CUSTOMER ACCOUNT MANAGEMENT API
// ============================================

app.get('/api/admin/customers', requireAdmin, requireOwner, (req, res, next) => {
  try {
    const customers = db.prepare(`
      SELECT id, customer_code, full_name, email, phone, status,
             COALESCE(is_disabled, 0) AS is_disabled, disabled_reason,
             disabled_at, created_at, updated_at
      FROM customers
      ORDER BY created_at DESC, id DESC
      LIMIT 500
    `).all();
    res.json({ success: true, count: customers.length, customers });
  } catch (error) { next(error); }
});

app.patch('/api/admin/customers/:id/access', requireAdmin, requireOwner, (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    const disabled = req.body?.disabled === true;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid customer ID.' });
    }
    if (disabled && (reason.length < 5 || reason.length > 500)) {
      return res.status(400).json({ success: false, error: 'Enter a reason between 5 and 500 characters.' });
    }
    const customer = db.prepare('SELECT id, status FROM customers WHERE id = ?').get(customerId);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer account not found.' });

    if (disabled) {
      db.prepare(`
        UPDATE customers
        SET is_disabled = 1, disabled_reason = ?,
            disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            disabled_by = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?
      `).run(reason, req.admin.id, customerId);
    } else {
      db.prepare(`
        UPDATE customers
        SET is_disabled = 0, disabled_reason = NULL,
            disabled_at = NULL, disabled_by = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?
      `).run(customerId);
    }
    res.json({ success: true, message: disabled ? 'Customer account disabled.' : 'Customer account re-enabled.' });
  } catch (error) { next(error); }
});

// ============================================
// SCBS OWNER ORDER MANAGEMENT API
// ============================================

// GET ALL CUSTOMER ORDERS — ADMIN ONLY
app.get('/api/admin/orders', requireAdmin, requirePermission('orders:read'), (req, res, next) => {
  try {
    const orders = db.prepare(`
      SELECT
        o.id,
        o.order_number,
        o.customer_id,
        o.status,
        o.currency,
        o.subtotal_ngwee,
        o.discount_ngwee,
        o.total_ngwee,
        o.customer_notes,
        o.admin_notes,
        o.cancellation_reason,
        o.cancelled_at,
        o.created_at,
        o.updated_at,
        c.customer_code,
        c.full_name AS customer_name,
        c.email AS customer_email,
        c.phone AS customer_phone,
        d.recipient_name,
        d.recipient_phone,
        d.city,
        d.district,
        d.area,
        d.delivery_status
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN order_delivery_addresses d ON d.order_id = o.id
      ORDER BY o.created_at DESC, o.id DESC
    `).all();

    res.json({
      success: true,
      count: orders.length,
      orders
    });
  } catch (error) {
    next(error);
  }
});

// GET ONE ORDER WITH ITEMS — ADMIN ONLY
app.get('/api/admin/orders/:id', requireAdmin, requirePermission('orders:read'), (req, res, next) => {
  try {
    const orderId = Number(req.params.id);

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order ID.'
      });
    }

    const order = db.prepare(`
      SELECT
        o.*,
        c.customer_code,
        c.full_name AS customer_name,
        c.email AS customer_email,
        c.phone AS customer_phone,
        d.recipient_name,
        d.recipient_phone,
        d.country,
        d.province,
        d.city,
        d.district,
        d.area,
        d.street,
        d.house_number,
        d.building_flat,
        d.landmark,
        d.delivery_instructions,
        d.delivery_status
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN order_delivery_addresses d ON d.order_id = o.id
      WHERE o.id = ?
    `).get(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found.'
      });
    }

    const items = db.prepare(`
      SELECT
        id,
        product_id,
        book_id,
        item_name,
        quantity,
        unit_price_ngwee,
        line_total_ngwee
      FROM order_items
      WHERE order_id = ?
      ORDER BY id ASC
    `).all(orderId);

    res.json({
      success: true,
      order: {
        ...order,
        items
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// END SCBS OWNER ORDER MANAGEMENT API
// ============================================

// ============================================
// SCBS OWNER ORDER STATUS API
// ============================================

app.patch('/api/admin/orders/:id/status', requireAdmin, requirePermission('orders:write'), (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const status = typeof req.body?.status === 'string'
      ? req.body.status.trim().toLowerCase()
      : '';

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order ID.'
      });
    }

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order status.',
        allowed_statuses: ORDER_STATUSES
      });
    }

    // All cancellations use the inventory-safe cancellation workflow.
    if (status === 'cancelled') {
      const cancellationReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (cancellationReason.length < 5 || cancellationReason.length > 500) {
        return res.status(400).json({
          success: false,
          error: 'Enter a cancellation reason between 5 and 500 characters.'
        });
      }
      const cancellation = cancelOrder(db, {
        orderId,
        adminId: req.admin.id,
        ipAddress: req.ip,
        source: 'admin'
      });

      if (!cancellation.success) {
        return res.status(cancellation.statusCode || 409).json({
          success: false,
          error: cancellation.error
        });
      }

      db.prepare(`
        UPDATE orders
        SET cancellation_reason = ?, cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            cancelled_by = ?
        WHERE id = ? AND status = 'cancelled'
      `).run(cancellationReason, req.admin.id, orderId);
      return res.json({
        success: true,
        message: 'Order cancelled and inventory restored successfully.',
        order: cancellation.order,
        inventory_restored: cancellation.inventory_restored
      });
    }

    const updateOrder = db.transaction(() => {
      const existingOrder = db.prepare(`
        SELECT id, status
        FROM orders
        WHERE id = ?
      `).get(orderId);

      if (!existingOrder) {
        return {
          error: 'Order not found.',
          statusCode: 404
        };
      }

      if (!canTransitionOrder(existingOrder.status, status)) {
        return {
          error: `Order cannot transition from '${existingOrder.status}' to '${status}'.`,
          statusCode: 409
        };
      }

      const updateResult = db.prepare(`
        UPDATE orders
        SET status = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND status = ?
      `).run(status, orderId, existingOrder.status);

      if (updateResult.changes !== 1) {
        return {
          error: 'Order status changed unexpectedly. Please refresh and try again.',
          statusCode: 409
        };
      }

      const updatedOrder = db.prepare(`
        SELECT id, order_number, status, total_ngwee, updated_at
        FROM orders
        WHERE id = ?
      `).get(orderId);

      return { order: updatedOrder };
    });

    const result = updateOrder();

    if (result.error) {
      return res.status(result.statusCode).json({
        success: false,
        error: result.error
      });
    }

    return res.json({
      success: true,
      message: 'Order status updated successfully.',
      order: result.order
    });
  } catch (error) {
    next(error);
  }
});
// END SCBS OWNER ORDER STATUS API
// ============================================

// ============================================
// SCBS OWNER DELIVERY MANAGEMENT API
// ============================================

app.patch('/api/admin/orders/:id/delivery', requireAdmin, requirePermission('orders:write'), (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const { delivery_status } = req.body;

    const allowedDeliveryStatuses = [
      'pending',
      'confirmed',
      'out_for_delivery',
      'delivered',
      'failed',
      'cancelled'
    ];

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order ID.'
      });
    }

    if (!allowedDeliveryStatuses.includes(delivery_status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid delivery status.'
      });
    }

    const existingDelivery = db.prepare(`
      SELECT id, delivery_status
      FROM order_delivery_addresses
      WHERE order_id = ?
    `).get(orderId);

    if (!existingDelivery) {
      return res.status(404).json({
        success: false,
        error: 'Delivery record not found.'
      });
    }

    db.prepare(`
      UPDATE order_delivery_addresses
      SET delivery_status = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE order_id = ?
    `).run(delivery_status, orderId);

    const updatedDelivery = db.prepare(`
      SELECT
        order_id,
        recipient_name,
        recipient_phone,
        city,
        district,
        delivery_status,
        updated_at
      FROM order_delivery_addresses
      WHERE order_id = ?
    `).get(orderId);

    res.json({
      success: true,
      message: 'Delivery status updated successfully.',
      delivery: updatedDelivery
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// END SCBS OWNER DELIVERY MANAGEMENT API
// ============================================

// ============================================
// SCBS CUSTOMER PAYMENT REQUEST API
// ============================================

app.post('/api/customer/orders/:id/payments', requireCustomer, (req, res, next) => {
  try {
    const orderId = Number(req.params.id);
    const { provider, idempotency_key } = req.body;

    const allowedProviders = ['mtn_momo', 'airtel_money'];

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order ID.'
      });
    }

    if (!allowedProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        error: 'Choose MTN MoMo or Airtel Money.'
      });
    }

    if (
      typeof idempotency_key !== 'string' ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(idempotency_key)
    ) {
      return res.status(400).json({
        success: false,
        error: 'A valid unique payment request key is required.'
      });
    }

    const order = db.prepare(`
      SELECT id, customer_id, status, currency, total_ngwee
      FROM orders
      WHERE id = ? AND customer_id = ?
    `).get(orderId, req.customer.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found.'
      });
    }

    if (order.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        error: 'Cancelled orders cannot be paid.'
      });
    }

    if (
      !Number.isSafeInteger(order.total_ngwee) ||
      order.total_ngwee <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: 'This order cannot be paid using this payment method.'
      });
    }    // Prevent another payment request when the order is already paid.
    const successfulPayment = db.prepare(`
      SELECT id, order_id, provider, amount_ngwee, currency, status
      FROM payments
      WHERE order_id = ?
        AND status = 'successful'
      LIMIT 1
    `).get(order.id);

    if (successfulPayment) {
      return res.status(409).json({
        success: false,
        error: 'This order already has a successful payment.',
        payment: successfulPayment
      });
    }

    // Reuse an existing pending payment instead of creating another.
    const pendingPayment = db.prepare(`
      SELECT id, order_id, provider, amount_ngwee, currency, status
      FROM payments
      WHERE order_id = ?
        AND status = 'pending'
      LIMIT 1
    `).get(order.id);

    if (pendingPayment) {
      if (pendingPayment.provider !== provider) {
        return res.status(409).json({
          success: false,
          error: 'This order already has a pending payment request. Complete or cancel it before choosing another provider.'
        });
      }

      return res.json({
        success: true,
        message: 'Existing pending payment request retrieved.',
        payment: pendingPayment
      });
    }

    const existingPayment = db.prepare(`
      SELECT id, order_id, provider, amount_ngwee, currency, status
      FROM payments
      WHERE idempotency_key = ?
    `).get(idempotency_key);

    if (existingPayment) {
      if (
        existingPayment.order_id !== order.id ||
        existingPayment.provider !== provider ||
        existingPayment.amount_ngwee !== order.total_ngwee
      ) {
        return res.status(409).json({
          success: false,
          error: 'This request key has already been used.'
        });
      }

      return res.json({
        success: true,
        message: 'Existing payment request retrieved.',
        payment: existingPayment
      });
    }

    const createPayment = db.transaction(() => {
      const previousPayment = db.prepare(`
        SELECT id, order_id, provider, amount_ngwee, currency, status
        FROM payments
        WHERE idempotency_key = ?
      `).get(idempotency_key);

      if (previousPayment) {
        if (
          previousPayment.order_id !== order.id ||
          previousPayment.provider !== provider ||
          previousPayment.amount_ngwee !== order.total_ngwee
        ) {
          throw new Error('PAYMENT_REQUEST_KEY_CONFLICT');
        }

        return previousPayment;
      }

      const result = db.prepare(`
        INSERT INTO payments (
          order_id,
          provider,
          amount_ngwee,
          currency,
          status,
          idempotency_key
        )
        VALUES (?, ?, ?, 'ZMW', 'pending', ?)
      `).run(
        order.id,
        provider,
        order.total_ngwee,
        idempotency_key
      );

      return db.prepare(`
        SELECT id, order_id, provider, amount_ngwee, currency, status
        FROM payments
        WHERE id = ?
      `).get(result.lastInsertRowid);
    });

    const payment = createPayment();

    return res.status(201).json({
      success: true,
      message: 'Pending payment record created. No money has been collected.',
      payment
    });
  } catch (error) {
    if (error.message === 'PAYMENT_REQUEST_KEY_CONFLICT') {
      return res.status(409).json({
        success: false,
        error: 'This request key has already been used.'
      });
    }

    next(error);
  }
});

// ============================================
// END SCBS CUSTOMER PAYMENT REQUEST API
// ============================================

// ============================================
// SCBS CUSTOMER PAYMENT HISTORY API
// ============================================

app.get('/api/customer/payments', requireCustomer, (req, res, next) => {
  try {
    const payments = db.prepare(`
      SELECT
        p.id,
        p.order_id,
        p.provider,
        p.amount_ngwee,
        p.currency,
        p.status,
        p.provider_reference,
        p.failure_reason,
        p.created_at,
        p.updated_at,
        o.order_number
      FROM payments p
      INNER JOIN orders o ON o.id = p.order_id
      WHERE o.customer_id = ?
      ORDER BY p.created_at DESC, p.id DESC
    `).all(req.customer.id);

    res.json({
      success: true,
      count: payments.length,
      payments
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// END SCBS CUSTOMER PAYMENT HISTORY API
// ============================================

// ============================================
// SCBS OWNER PAYMENT MANAGEMENT API
// ============================================

// GET ALL PAYMENT RECORDS — ADMIN ONLY
app.get('/api/admin/payments', requireAdmin, requireOwner, (req, res, next) => {
  try {
    const payments = db.prepare(`
      SELECT
        p.id,
        p.order_id,
        p.provider,
        p.amount_ngwee,
        p.currency,
        p.status,
        p.provider_reference,
        p.failure_reason,
        p.created_at,
        p.updated_at,
        o.order_number,
        o.status AS order_status,
        c.customer_code,
        c.full_name AS customer_name,
        c.email AS customer_email,
        c.phone AS customer_phone
      FROM payments p
      INNER JOIN orders o ON o.id = p.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      ORDER BY p.created_at DESC, p.id DESC
    `).all();

    res.json({
      success: true,
      count: payments.length,
      payments
    });
  } catch (error) {
    next(error);
  }
});

// GET PAYMENT DETAILS — ADMIN ONLY
app.get('/api/admin/payments/:id', requireAdmin, requireOwner, (req, res, next) => {
  try {
    const paymentId = Number(req.params.id);

    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment ID.'
      });
    }

    const payment = db.prepare(`
      SELECT
        p.id,
        p.order_id,
        p.provider,
        p.amount_ngwee,
        p.currency,
        p.status,
        p.provider_reference,
        p.failure_reason,
        p.created_at,
        p.updated_at,
        o.order_number,
        o.status AS order_status,
        o.total_ngwee AS order_total_ngwee,
        c.customer_code,
        c.full_name AS customer_name,
        c.email AS customer_email,
        c.phone AS customer_phone
      FROM payments p
      INNER JOIN orders o ON o.id = p.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE p.id = ?
    `).get(paymentId);

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment record not found.'
      });
    }

    res.json({
      success: true,
      payment
    });
  } catch (error) {
    next(error);
  }
});

// Reject a pending demo/manual payment request. Successful status is
// deliberately unavailable until a real provider integration can verify payment.
app.post('/api/admin/payments/:id/reject', requireAdmin, requireOwner, (req, res, next) => {
  try {
    const paymentId = Number(req.params.id);
    const reason = typeof req.body?.reason === 'string'
      ? req.body.reason.trim()
      : '';

    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid payment ID.' });
    }
    if (reason.length < 3 || reason.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Enter a rejection reason between 3 and 500 characters.'
      });
    }

    const payment = db.prepare(`
      SELECT id, order_id, status FROM payments WHERE id = ?
    `).get(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment record not found.' });
    }
    if (payment.status !== 'pending') {
      return res.status(409).json({
        success: false,
        error: 'Only pending payment requests can be rejected.'
      });
    }

    const updatePayment = db.transaction(() => {
      const update = db.prepare(`
        UPDATE payments
        SET status = 'failed', failure_reason = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'pending'
      `).run(reason, paymentId);
      if (update.changes !== 1) return false;

      db.prepare(`
        INSERT INTO audit_logs
          (admin_id, action, entity_type, entity_id, details_json, ip_address)
        VALUES (?, 'payment_rejected', 'payment', ?, ?, ?)
      `).run(
        req.admin.id,
        paymentId,
        JSON.stringify({ order_id: payment.order_id, reason }),
        String(req.ip || '').slice(0, 100)
      );
      return true;
    });

    if (!updatePayment()) {
      return res.status(409).json({
        success: false,
        error: 'This payment was changed by another request. Refresh and try again.'
      });
    }

    res.json({
      success: true,
      message: 'Payment request marked failed. No money was collected by SCBS.',
      payment: db.prepare(`SELECT id, status, failure_reason, updated_at FROM payments WHERE id = ?`).get(paymentId)
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// END SCBS OWNER PAYMENT MANAGEMENT API
// ============================================

// ============================================
// SCBS DATABASE API — READ PRODUCTS & SERVICES
// ============================================

// Retrieve active products from the SCBS database.
app.get('/api/products', (req, res) => {
  try {
    const products = db.prepare(`
      SELECT
        p.id,
        p.sku,
        p.name,
        p.description,
        p.product_type,
        p.price_ngwee,
        p.stock_quantity,
        p.image_url,
        c.name AS category
      FROM products AS p
      LEFT JOIN categories AS c ON c.id = p.category_id
      WHERE p.is_active = 1
      ORDER BY p.name COLLATE NOCASE
      LIMIT 200
    `).all();

    res.json({
      success: true,
      count: products.length,
      products
    });
  } catch (error) {
    console.error('SCBS product retrieval failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Unable to retrieve products.'
    });
  }
});  

// SCBS PRODUCT CREATION API
// Local development only — not for public use
// ============================================

app.post('/api/products', requireAdmin, requirePermission('products:write'), (req, res) => {
  try {
    // Do not allow unauthenticated writes in production.
    
    const {
  sku,
  name,
  description = '',
  image_url = '',
  product_type = 'general',
  price_ngwee,
  stock_quantity = 0,
  category_id = null
} = req.body || {};

    const allowedTypes = [
      'grocery',
      'phone',
      'accessory',
      'electronics',
      'general'
    ];

    if (
      typeof sku !== 'string' ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(sku.trim())
    ) {
      return res.status(400).json({
        success: false,
        error: 'SKU must contain 2–40 letters, numbers, underscores or hyphens.'
      });
    }

    if (
      typeof name !== 'string' ||
      name.trim().length < 2 ||
      name.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        error: 'Product name must contain 2–150 characters.'
      });
    }

    if (
      typeof price_ngwee !== 'number' ||
      !Number.isSafeInteger(price_ngwee) ||
      price_ngwee < 0
    ) {
      return res.status(400).json({
        success: false,
        error: 'price_ngwee must be a non-negative whole number.'
      });
    }

    if (
      !Number.isSafeInteger(stock_quantity) ||
      stock_quantity < 0
    ) {
      return res.status(400).json({
        success: false,
        error: 'stock_quantity must be a non-negative whole number.'
      });
    }

    if (!allowedTypes.includes(product_type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product type.'
      });
    }

    if (
      typeof description !== 'string' ||
      description.length > 2000
    ) {
      return res.status(400).json({
        success: false,
        error: 'Description must be text of no more than 2000 characters.'
      });
    }

    if (
      category_id !== null &&
      (!Number.isSafeInteger(category_id) || category_id <= 0)
    ) {
      return res.status(400).json({
        success: false,
        error: 'category_id must be a positive integer or null.'
      });
    }

    const insertProduct = db.prepare(`
  INSERT INTO products (
    sku,
    category_id,
    name,
    description,
    image_url,
    product_type,
    price_ngwee,
    stock_quantity
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

    const result = insertProduct.run(
  sku.trim(),
  category_id,
  name.trim(),
  description.trim(),
  image_url.trim(),
  product_type,
  price_ngwee,
  stock_quantity
);

    const product = db.prepare(`
      SELECT
        id,
        sku,
        category_id,
        name,
        description,
        product_type,
        price_ngwee,
        stock_quantity,
        is_active,
        created_at
      FROM products
      WHERE id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json({
      success: true,
      message: 'Product saved to the SCBS database.',
      product
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        success: false,
        error: 'That SKU already exists. Choose a different SKU.'
      });
    }

    console.error('SCBS product creation failed:', error.message);

    return res.status(500).json({
      success: false,
      error: 'Unable to save the product.'
    });
  }
});

// Retrieve active Multi-Tech and general services.
// Update an existing SCBS product. Administrator access required.
app.put('/api/products/:id', requireAdmin, requirePermission('products:write'), (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID.'
      });
    }

    const {
  sku,
  name,
  description = '',
  image_url = '',
  product_type = 'general',
  price_ngwee,
  stock_quantity = 0
} = req.body || {};

    const allowedTypes = [
      'grocery',
      'phone',
      'accessory',
      'electronics',
      'general'
    ];

    if (typeof sku !== 'string' ||
        !/^[A-Za-z0-9_-]{2,40}$/.test(sku.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid SKU.'
      });
    }

    if (typeof name !== 'string' ||
        name.trim().length < 2 ||
        name.trim().length > 150) {
      return res.status(400).json({
        success: false,
        error: 'Product name must contain 2–150 characters.'
      });
    }

    if (typeof description !== 'string' ||
        description.length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Description must not exceed 2000 characters.'
      });
    }

    if (!allowedTypes.includes(product_type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product type.'
      });
    }

    if (!Number.isSafeInteger(price_ngwee) || price_ngwee < 0) {
      return res.status(400).json({
        success: false,
        error: 'Price must be a non-negative whole number in ngwee.'
      });
    }

    if (!Number.isSafeInteger(stock_quantity) || stock_quantity < 0) {
      return res.status(400).json({
        success: false,
        error: 'Stock must be a non-negative whole number.'
      });
    }

    const existing = db.prepare(
      'SELECT id FROM products WHERE id = ?'
    ).get(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Product not found.'
      });
    }

    db.prepare(`
  UPDATE products
  SET sku = ?,
      name = ?,
      description = ?,
      image_url = ?,
      product_type = ?,
      price_ngwee = ?,
      stock_quantity = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?
`).run(
        sku.trim(),
  name.trim(),
  description.trim(),
  image_url.trim(),
  product_type,
  price_ngwee,
  stock_quantity,
  id
);

    const product = db.prepare(`
  SELECT id, sku, name, description, image_url, product_type,
         price_ngwee, stock_quantity, updated_at
  FROM products
  WHERE id = ?
`).get(id);

    return res.json({
      success: true,
      message: 'Product updated successfully.',
      product
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        success: false,
        error: 'That SKU already exists. Choose a different SKU.'
      });
    }

    console.error('SCBS product update failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to update the product.'
    });
  }
});
// Administrator-only service image upload (JPEG, PNG, WebP; 2 MB maximum).
app.post('/api/services/image', requireAdmin, requirePermission('services:write'), (req, res, next) => {
  serviceImageUpload.single('image')(req, res, (error) => {
    if (!error) return next();
    const status = error instanceof multer.MulterError
      ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      : 400;
    return res.status(status).json({
      success: false,
      error: error.message || 'Unable to upload service image.'
    });
  });
}, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Choose an image first.' });
  }
  const type = SERVICE_IMAGE_TYPES.get(req.file.mimetype);
  try {
    const filePath = req.file.path;
    fs.readFile(filePath).then((buffer) => {
      const signature = type?.signature || [];
      const signatureMatches = signature.every((byte, index) => buffer[index] === byte);
      const extraMatches = !type?.extraSignature ||
        type.extraSignature.every((byte, index) => buffer[index + 8] === byte);
      if (!signatureMatches || !extraMatches) {
        return fs.unlink(filePath).catch(() => {}).then(() =>
          res.status(400).json({ success: false, error: 'The uploaded file is not a valid image of the selected type.' })
        );
      }
      return res.json({
        success: true,
        image_url: `/uploads/service-images/${req.file.filename}`,
        message: 'Service image uploaded.'
      });
    }).catch(() => res.status(500).json({ success: false, error: 'Unable to verify service image.' }));
  } catch {
    return res.status(500).json({ success: false, error: 'Unable to verify service image.' });
  }
});

app.get('/api/services', (req, res) => {
  try {
    const services = db.prepare(`
      SELECT
        id,
        service_code,
        name,
        category,
        description,
        price_ngwee,
        pricing_type,
        estimated_duration,
        image_url
      FROM services
      WHERE is_active = 1
      ORDER BY name COLLATE NOCASE
      LIMIT 200
    `).all();

    res.json({
      success: true,
      count: services.length,
      services
    });
  } catch (error) {
    console.error('SCBS service retrieval failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Unable to retrieve services.'
    });
  }
});

// ============================================
// SCBS SERVICE CREATION API
// Local development only — not for public use
// ============================================

app.post('/api/services', requireAdmin, requirePermission('services:write'), (req, res) => {
  try {
    // Require a separate authenticated admin API before production use.
        const {
      service_code,
      name,
      category = 'multi-tech',
      description = '',
      price_ngwee = null,
      pricing_type = 'quote',
      estimated_duration = '',
      image_url = null
    } = req.body || {};

    const allowedPricingTypes = ['fixed', 'from', 'quote'];

    if (
      typeof service_code !== 'string' ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(service_code.trim())
    ) {
      return res.status(400).json({
        success: false,
        error: 'Service code must contain 2–40 valid characters.'
      });
    }

    if (
      typeof name !== 'string' ||
      name.trim().length < 2 ||
      name.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        error: 'Service name must contain 2–150 characters.'
      });
    }

    if (
      typeof category !== 'string' ||
      category.trim().length < 2 ||
      category.trim().length > 80
    ) {
      return res.status(400).json({
        success: false,
        error: 'Category must contain 2–80 characters.'
      });
    }

    if (
      typeof description !== 'string' ||
      description.length > 3000
    ) {
      return res.status(400).json({
        success: false,
        error: 'Description cannot exceed 3000 characters.'
      });
    }

    if (
      price_ngwee !== null &&
      (
        typeof price_ngwee !== 'number' ||
        !Number.isSafeInteger(price_ngwee) ||
        price_ngwee < 0
      )
    ) {
      return res.status(400).json({
        success: false,
        error: 'Price must be a non-negative whole number of ngwee or null.'
      });
    }

    if (!allowedPricingTypes.includes(pricing_type)) {
      return res.status(400).json({
        success: false,
        error: 'Pricing type must be fixed, from, or quote.'
      });
    }

    if (
      typeof estimated_duration !== 'string' ||
      estimated_duration.length > 100
    ) {
      return res.status(400).json({
        success: false,
        error: 'Estimated duration cannot exceed 100 characters.'
      });
    }

    const result = db.prepare(`
      INSERT INTO services (
        service_code,
        name,
        category,
        description,
        price_ngwee,
        pricing_type,
        estimated_duration,
        image_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      service_code.trim(),
      name.trim(),
      category.trim(),
      description.trim(),
      price_ngwee,
      pricing_type,
      estimated_duration.trim(),
      typeof image_url === 'string' && /^\/uploads\/service-images\/[A-Za-z0-9-]+\.(?:jpg|png|webp)$/.test(image_url) ? image_url : null
    );

    const service = db.prepare(`
      SELECT
        id,
        service_code,
        name,
        category,
        description,
        price_ngwee,
        pricing_type,
        estimated_duration,
        image_url,
        is_active,
        created_at
      FROM services
      WHERE id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json({
      success: true,
      message: 'Service saved to the SCBS database.',
      service
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        success: false,
        error: 'That service code already exists.'
      });
    }

    console.error('SCBS service creation failed:', error.message);

    return res.status(500).json({
      success: false,
      error: 'Unable to save the service.'
    });
  }
});

// ============================================
// ============================================
// SCBS SERVICE MANAGEMENT API
// Administrator access required for changes
// ============================================

// List all services for the administrator, including inactive ones.
app.get('/api/admin/services', requireAdmin, requirePermission('services:read'), (req, res) => {
  try {
    const services = db.prepare(`
      SELECT
        id,
        service_code,
        name,
        category,
        description,
        price_ngwee,
        pricing_type,
        estimated_duration,
        image_url,
        is_active,
        created_at,
        updated_at
      FROM services
      ORDER BY name COLLATE NOCASE
      LIMIT 200
    `).all();

    return res.json({
      success: true,
      count: services.length,
      services
    });
  } catch (error) {
    console.error('SCBS admin service retrieval failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to retrieve services.'
    });
  }
});

// Edit an existing service.
app.put('/api/services/:id', requireAdmin, requirePermission('services:write'), (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid service ID.'
      });
    }

    const {
      service_code,
      name,
      category = 'multi-tech',
      description = '',
      price_ngwee = null,
      pricing_type = 'quote',
      estimated_duration = '',
      image_url = null
    } = req.body || {};

    if (
      typeof service_code !== 'string' ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(service_code.trim())
    ) {
      return res.status(400).json({
        success: false,
        error: 'Service code must contain 2–40 valid characters.'
      });
    }

    if (
      typeof name !== 'string' ||
      name.trim().length < 2 ||
      name.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        error: 'Service name must contain 2–150 characters.'
      });
    }

    if (
      typeof category !== 'string' ||
      category.trim().length < 2 ||
      category.trim().length > 80
    ) {
      return res.status(400).json({
        success: false,
        error: 'Category must contain 2–80 characters.'
      });
    }

    if (
      typeof description !== 'string' ||
      description.length > 3000
    ) {
      return res.status(400).json({
        success: false,
        error: 'Description cannot exceed 3000 characters.'
      });
    }

    if (
      price_ngwee !== null &&
      (
        typeof price_ngwee !== 'number' ||
        !Number.isSafeInteger(price_ngwee) ||
        price_ngwee < 0
      )
    ) {
      return res.status(400).json({
        success: false,
        error: 'Price must be a non-negative whole number of ngwee or null.'
      });
    }

    if (!['fixed', 'from', 'quote'].includes(pricing_type)) {
      return res.status(400).json({
        success: false,
        error: 'Pricing type must be fixed, from, or quote.'
      });
    }

    if (
      typeof estimated_duration !== 'string' ||
      estimated_duration.length > 100
    ) {
      return res.status(400).json({
        success: false,
        error: 'Estimated duration cannot exceed 100 characters.'
      });
    }

    const result = db.prepare(`
      UPDATE services
      SET
        service_code = ?,
        name = ?,
        category = ?,
        description = ?,
        price_ngwee = ?,
        pricing_type = ?,
        estimated_duration = ?,
        image_url = CASE WHEN ? IS NULL THEN image_url ELSE ? END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(
      service_code.trim(),
      name.trim(),
      category.trim(),
      description.trim(),
      price_ngwee,
      pricing_type,
      estimated_duration.trim(),
      typeof image_url === 'string' && /^\/uploads\/service-images\/[A-Za-z0-9-]+\.(?:jpg|png|webp)$/.test(image_url) ? image_url : null,
      typeof image_url === 'string' && /^\/uploads\/service-images\/[A-Za-z0-9-]+\.(?:jpg|png|webp)$/.test(image_url) ? image_url : null,
      id
    );

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Service not found.'
      });
    }

    const service = db.prepare(`
      SELECT *
      FROM services
      WHERE id = ?
    `).get(id);

    return res.json({
      success: true,
      message: 'Service updated successfully.',
      service
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        success: false,
        error: 'That service code already exists.'
      });
    }

    console.error('SCBS service update failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to update the service.'
    });
  }
});

// Activate or deactivate a service without deleting it.
app.patch('/api/services/:id/status', requireAdmin, requirePermission('services:write'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { is_active } = req.body || {};

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid service ID.'
      });
    }

    if (is_active !== 0 && is_active !== 1) {
      return res.status(400).json({
        success: false,
        error: 'is_active must be 0 or 1.'
      });
    }

    const result = db.prepare(`
      UPDATE services
      SET
        is_active = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(is_active, id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Service not found.'
      });
    }

    return res.json({
      success: true,
      message: is_active === 1
        ? 'Service activated successfully.'
        : 'Service deactivated successfully.'
    });
  } catch (error) {
    console.error('SCBS service status update failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to update service status.'
    });
  }
});

// SCBS CUSTOMER ENQUIRIES API
// Development-only endpoint
// ============================================


app.post('/api/messages', customerMessageLimiter, (req, res) => {
  try {
    const {
      name,
      email = '',
      phone = '',
      subject,
      message
    } = req.body || {};

    if (
      typeof name !== 'string' ||
      name.trim().length < 2 ||
      name.trim().length > 100
    ) {
      return res.status(400).json({
        success: false,
        error: 'Name must contain 2–100 characters.'
      });
    }

    if (
      typeof email !== 'string' ||
      email.length > 254 ||
      (email.trim() !== '' &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    ) {
      return res.status(400).json({
        success: false,
        error: 'Enter a valid email address or leave it empty.'
      });
    }

    if (
      typeof phone !== 'string' ||
      phone.length > 30 ||
      (phone !== '' && !/^[+0-9()\s-]+$/.test(phone))
    ) {
      return res.status(400).json({
        success: false,
        error: 'Enter a valid phone number or leave it empty.'
      });
    }

    if (
      typeof subject !== 'string' ||
      subject.trim().length < 3 ||
      subject.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        error: 'Subject must contain 3–150 characters.'
      });
    }

    if (
      typeof message !== 'string' ||
      message.trim().length < 10 ||
      message.trim().length > 5000
    ) {
      return res.status(400).json({
        success: false,
        error: 'Message must contain 10–5000 characters.'
      });
    }

    const referenceCode =
      'SCBS-MSG-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();

    const result = db.prepare(`
      INSERT INTO messages (
        reference_code,
        customer_id,
        name,
        email,
        phone,
        subject,
        message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      referenceCode,
      Number.isSafeInteger(req.session?.customerId) ? req.session.customerId : null,
      name.trim(),
      email.trim(),
      phone.trim(),
      subject.trim(),
      message.trim()
    );

    return res.status(201).json({
      success: true,
      message: 'Your enquiry has been saved.',
      reference: referenceCode,
      enquiryId: result.lastInsertRowid
    });
  } catch (error) {
    console.error('SCBS enquiry save failed:', error.message);

    return res.status(500).json({
      success: false,
      error: 'We could not save your enquiry. Please try again later.'
    });
  }
});

// ============================================
// SCBS CUSTOMER PORTAL: PRIVATE MESSAGES
// ============================================
app.get('/api/customer/messages/unread-count', requireCustomer, (req, res) => {
  try {
    const unreadCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages
      WHERE customer_id = ?
        AND admin_reply IS NOT NULL AND trim(admin_reply) <> ''
        AND (customer_last_seen_at IS NULL OR admin_replied_at > customer_last_seen_at)
    `).get(req.customer.id).count;
    return res.json({ success: true, unreadCount });
  } catch (error) {
    console.error('SCBS customer message notification failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to check message notifications.' });
  }
});

app.get('/api/customer/messages', requireCustomer, (req, res) => {
  try {
    const unreadCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages
      WHERE customer_id = ?
        AND admin_reply IS NOT NULL AND trim(admin_reply) <> ''
        AND (customer_last_seen_at IS NULL OR admin_replied_at > customer_last_seen_at)
    `).get(req.customer.id).count;

    const rows = db.prepare(`
      SELECT id, reference_code, subject, message, status, admin_reply,
             admin_replied_at, created_at, updated_at
      FROM messages
      WHERE customer_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(req.customer.id);

    if (rows.length) {
      const ids = rows.map(row => row.id);
      const updateSeen = db.prepare(`
        UPDATE messages
        SET customer_last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE customer_id = ? AND id = ?
      `);
      const markSeen = db.transaction(() => {
        for (const id of ids) updateSeen.run(req.customer.id, id);
      });
      markSeen();
    }

    return res.json({ success: true, messages: rows, unreadCount });
  } catch (error) {
    console.error('SCBS customer messages read failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load your messages.' });
  }
});

app.post('/api/customer/messages', requireCustomer, customerMessageLimiter, (req, res) => {
  try {
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (subject.length < 3 || subject.length > 150) {
      return res.status(400).json({ success: false, error: 'Subject must contain 3–150 characters.' });
    }
    if (message.length < 10 || message.length > 5000) {
      return res.status(400).json({ success: false, error: 'Message must contain 10–5000 characters.' });
    }

    const referenceCode = 'SCBS-MSG-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const result = db.prepare(`
      INSERT INTO messages (reference_code, customer_id, name, email, phone, subject, message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      referenceCode,
      req.customer.id,
      req.customer.full_name,
      req.customer.email || '',
      req.customer.phone || '',
      subject,
      message
    );

    return res.status(201).json({
      success: true,
      message: 'Your message has been sent to SCBS.',
      reference: referenceCode,
      id: result.lastInsertRowid
    });
  } catch (error) {
    console.error('SCBS customer message send failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to send your message.' });
  }
});

// ============================================
// SCBS ADMIN: CUSTOMER MESSAGES MANAGEMENT
// ============================================

// Retrieve customer enquiries securely.
app.get('/api/admin/messages', requireAdmin, requirePermission('customer_messages:read'), (req, res) => {
  try {
    const status = String(req.query.status || '').trim();

    const allowedStatuses = ['new', 'read', 'in_progress', 'resolved', 'spam'];

    let messages;

    if (status && allowedStatuses.includes(status)) {
      messages = db.prepare(`
        SELECT id, reference_code, name, email, phone,
               subject, message, status, admin_notes, admin_reply, admin_replied_at,
               created_at, updated_at
        FROM messages
        WHERE status = ?
        ORDER BY created_at DESC
        LIMIT 200
      `).all(status);
    } else if (status) {
      return res.status(400).json({
        success: false,
        error: 'Invalid message status.'
      });
    } else {
      messages = db.prepare(`
        SELECT id, reference_code, name, email, phone,
               subject, message, status, admin_notes, admin_reply, admin_replied_at,
               created_at, updated_at
        FROM messages
        ORDER BY created_at DESC
        LIMIT 200
      `).all();
    }

    return res.json({
      success: true,
      count: messages.length,
      messages
    });
  } catch (error) {
    console.error('SCBS admin messages failed:', error.message);

    return res.status(500).json({
      success: false,
      error: 'Unable to load customer messages.'
    });
  }
});

// Update a message's status and administrator notes.
app.patch('/api/admin/messages/:id', requireAdmin, requirePermission('customer_messages:write'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, admin_notes = '', admin_reply = '' } = req.body || {};

    const allowedStatuses = [
      'new', 'read', 'in_progress', 'resolved', 'spam'
    ];

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid message ID.'
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid message status.'
      });
    }

    if (
      typeof admin_reply !== 'string' ||
      admin_reply.length > 5000
    ) {
      return res.status(400).json({
        success: false,
        error: 'Administrator reply must be 5000 characters or fewer.'
      });
    }

    if (
      typeof admin_notes !== 'string' ||
      admin_notes.length > 2000
    ) {
      return res.status(400).json({
        success: false,
        error: 'Administrator notes must be 2000 characters or fewer.'
      });
    }

    const result = db.prepare(`
      UPDATE messages
      SET status = ?,
          admin_notes = ?,
          admin_reply = ?,
          admin_replied_at = CASE
            WHEN trim(?) <> '' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            ELSE admin_replied_at
          END,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(status, admin_notes.trim(), admin_reply.trim(), admin_reply.trim(), id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Customer message not found.'
      });
    }

    return res.json({
      success: true,
      message: 'Customer message updated successfully.'
    });
  } catch (error) {
    console.error('SCBS message update failed:', error.message);

    return res.status(500).json({
      success: false,
      error: 'Unable to update customer message.'
    });
  }
});



// ============================================
// SCBS CUSTOMER COMMUNITY POSTS — additive feature; existing SCBS posts remain unchanged.
db.exec(`
  CREATE TABLE IF NOT EXISTS scbs_customer_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
    image_url TEXT,
    share_contact INTEGER NOT NULL DEFAULT 0 CHECK(share_contact IN (0,1)),
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','removed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS scbs_customer_posts_public_idx
    ON scbs_customer_posts(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS scbs_customer_posts_customer_idx
    ON scbs_customer_posts(customer_id, created_at DESC);
`);

const CUSTOMER_POST_IMAGE_DIR = path.join(__dirname, 'public', 'uploads', 'customer-posts');
const CUSTOMER_POST_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const CUSTOMER_POST_IMAGE_TYPES = new Map([
  ['image/jpeg', { extension: '.jpg', signature: [0xff, 0xd8, 0xff] }],
  ['image/png', { extension: '.png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  ['image/webp', { extension: '.webp', signature: [0x52, 0x49, 0x46, 0x46], extraSignature: [0x57, 0x45, 0x42, 0x50] }]
]);
const customerPostImageStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, CUSTOMER_POST_IMAGE_DIR),
  filename: (_req, file, callback) => {
    const type = CUSTOMER_POST_IMAGE_TYPES.get(file.mimetype);
    if (!type) return callback(new Error('Unsupported customer post image format.'));
    callback(null, `${randomUUID()}${type.extension}`);
  }
});
const customerPostImageUpload = multer({
  storage: customerPostImageStorage,
  limits: { fileSize: CUSTOMER_POST_IMAGE_MAX_BYTES, files: 1, fields: 2, parts: 3 },
  fileFilter: (_req, file, callback) => {
    if (!CUSTOMER_POST_IMAGE_TYPES.has(file.mimetype)) {
      return callback(new Error('Choose a JPEG, PNG, or WebP photo up to 2 MB.'));
    }
    callback(null, true);
  }
});
await fs.mkdir(CUSTOMER_POST_IMAGE_DIR, { recursive: true });

const customerPostLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'You have posted several times. Please wait before posting again.' }
});

// Public feed. Email and phone are returned only when the customer explicitly opts in.
app.get('/api/customer-posts', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT p.id, p.body, p.image_url, p.share_contact, p.created_at,
             c.id AS owner_id, c.full_name, c.email, c.phone, c.profile_picture_url
      FROM scbs_customer_posts p
      JOIN customers c ON c.id = p.customer_id
      WHERE p.status = 'published' AND c.status = 'active' AND COALESCE(c.is_disabled, 0) = 0
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 100
    `).all();
    const posts = rows.map(row => ({
      id: row.id,
      body: row.body,
      image_url: row.image_url,
      created_at: row.created_at,
      author_name: row.full_name,
      profile_picture_url: row.profile_picture_url,
      email: row.share_contact ? row.email : null,
      phone: row.share_contact ? row.phone : null,
      is_mine: Number(req.session?.customerId) === Number(row.owner_id)
    }));
    return res.json({ success: true, posts });
  } catch (error) {
    console.error('SCBS customer community feed failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load customer community posts.' });
  }
});

// Signed-in customers can publish a short text post and one optional image.
app.post('/api/customer-posts', requireCustomer, customerPostLimiter, (req, res, next) => {
  customerPostImageUpload.single('photo')(req, res, error => {
    if (!error) return next();
    const status = error instanceof multer.MulterError
      ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      : 400;
    return res.status(status).json({
      success: false,
      error: error.code === 'LIMIT_FILE_SIZE'
        ? 'Photo must be 2 MB or smaller.'
        : error.message || 'Photo upload failed.'
    });
  });
}, async (req, res) => {
  let uploadedPath = req.file?.path || null;
  try {
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.length > 1000) {
      if (uploadedPath) await fs.unlink(uploadedPath).catch(() => {});
      return res.status(400).json({ success: false, error: 'Write between 1 and 1000 characters before posting.' });
    }

    if (req.file) {
      const bytes = await fs.readFile(req.file.path);
      const type = CUSTOMER_POST_IMAGE_TYPES.get(req.file.mimetype);
      const signatureMatches = type && type.signature.every((byte, index) => bytes[index] === byte);
      const webpMatches = type?.extraSignature
        ? type.extraSignature.every((byte, index) => bytes[index + 8] === byte)
        : true;
      const pngMatches = req.file.mimetype !== 'image/png' || bytes.subarray(12, 16).toString('ascii') === 'IHDR';
      const jpegMatches = req.file.mimetype !== 'image/jpeg' || (bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9);
      if (!signatureMatches || !webpMatches || !pngMatches || !jpegMatches || (req.file.mimetype === 'image/webp' && bytes.length < 12)) {
        await fs.unlink(uploadedPath).catch(() => {});
        uploadedPath = null;
        return res.status(400).json({ success: false, error: 'The uploaded photo is not a valid supported image.' });
      }
    }

    const imageUrl = req.file ? `/uploads/customer-posts/${req.file.filename}` : null;
    const shareContact = req.body?.share_contact === 'yes' ? 1 : 0;
    const result = db.prepare(`
      INSERT INTO scbs_customer_posts (customer_id, body, image_url, share_contact, status)
      VALUES (?, ?, ?, ?, 'published')
    `).run(req.customer.id, body, imageUrl, shareContact);
    return res.status(201).json({ success: true, message: 'Your post is now visible in the SCBS community.', id: Number(result.lastInsertRowid) });
  } catch (error) {
    if (uploadedPath) await fs.unlink(uploadedPath).catch(() => {});
    console.error('SCBS customer post creation failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to publish your post.' });
  }
});

app.delete('/api/customer-posts/:id', requireCustomer, customerPostLimiter, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'Invalid post ID.' });
    const result = db.prepare(`DELETE FROM scbs_customer_posts WHERE id = ? AND customer_id = ?`).run(id, req.customer.id);
    if (!result.changes) return res.status(404).json({ success: false, error: 'Your post was not found.' });
    return res.json({ success: true, message: 'Your post was deleted.' });
  } catch (error) {
    console.error('SCBS customer post deletion failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to delete your post.' });
  }
});


// SCBS POSTS — public reading, admin publishing
// ============================================
const postWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false
});

app.get('/api/posts', (_req, res) => {
  try {
    const posts = db.prepare(`
      SELECT id, title, body, image_url, is_announcement,
             published_at, created_at, updated_at
      FROM scbs_posts
      WHERE status = 'published'
      ORDER BY COALESCE(published_at, created_at) DESC, id DESC
      LIMIT 100
    `).all();
    const announcement = db.prepare(`
      SELECT id, title, body, published_at
      FROM scbs_posts
      WHERE status = 'published' AND is_announcement = 1
      ORDER BY COALESCE(published_at, created_at) DESC, id DESC
      LIMIT 1
    `).get() || null;
    return res.json({ success: true, posts, announcement });
  } catch (error) {
    console.error('SCBS public posts failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load SCBS posts.' });
  }
});

app.get('/api/admin/posts', requireAdmin, requirePermission('posts:read'), (_req, res) => {
  try {
    const posts = db.prepare(`
      SELECT id, title, body, image_url, is_announcement, status,
             created_at, updated_at, published_at
      FROM scbs_posts
      ORDER BY created_at DESC, id DESC
      LIMIT 200
    `).all();
    return res.json({ success: true, posts });
  } catch (error) {
    console.error('SCBS admin posts failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load posts.' });
  }
});

app.post('/api/admin/posts', requireAdmin, requirePermission('posts:write'), postWriteLimiter, (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const imageUrl = typeof req.body?.image_url === 'string' ? req.body.image_url.trim() : '';
    const announcement = req.body?.is_announcement === true || req.body?.is_announcement === 1;
    const status = req.body?.status === undefined ? 'draft' : req.body.status;

    if (title.length < 2 || title.length > 150) {
      return res.status(400).json({ success: false, error: 'Title must be 2–150 characters.' });
    }
    if (!body || body.length > 5000) {
      return res.status(400).json({ success: false, error: 'Post text must be 1–5000 characters.' });
    }
    if (!['draft', 'published', 'paused'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid post status.' });
    }
    if (imageUrl && imageUrl.length > 1000) {
      return res.status(400).json({ success: false, error: 'Image reference is too long.' });
    }
    if (imageUrl) {
      let parsed;
      try { parsed = new URL(imageUrl, 'http://scbs.local'); }
      catch { return res.status(400).json({ success: false, error: 'Invalid image URL.' }); }
      if (parsed.protocol !== 'https:' && !(parsed.origin === 'http://scbs.local' && imageUrl.startsWith('/'))) {
        return res.status(400).json({ success: false, error: 'Use an HTTPS image URL or a local /uploads/ image path.' });
      }
      if (imageUrl.startsWith('//') || imageUrl.includes('..')) {
        return res.status(400).json({ success: false, error: 'Invalid image path.' });
      }
    }
    const result = db.prepare(`
      INSERT INTO scbs_posts (title, body, image_url, is_announcement, status, created_by, published_at)
      VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END)
    `).run(title, body, imageUrl || null, announcement ? 1 : 0, status, req.admin.id, status);
    return res.status(201).json({ success: true, message: 'SCBS post created.', id: Number(result.lastInsertRowid) });
  } catch (error) {
    console.error('SCBS post creation failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to create SCBS post.' });
  }
});

app.patch('/api/admin/posts/:id', requireAdmin, requirePermission('posts:write'), postWriteLimiter, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'Invalid post ID.' });
    const existing = db.prepare('SELECT * FROM scbs_posts WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: 'Post not found.' });
    const status = req.body?.status;
    if (!['draft', 'published', 'paused'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid post status.' });
    db.prepare(`UPDATE scbs_posts SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE published_at END
      WHERE id = ?`).run(status, status, id);
    return res.json({ success: true, message: 'Post status updated.' });
  } catch (error) {
    console.error('SCBS post update failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to update post.' });
  }
});

app.delete('/api/admin/posts/:id', requireAdmin, requirePermission('posts:write'), postWriteLimiter, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'Invalid post ID.' });
    const result = db.prepare('DELETE FROM scbs_posts WHERE id = ?').run(id);
    if (!result.changes) return res.status(404).json({ success: false, error: 'Post not found.' });
    return res.json({ success: true, message: 'Post deleted.' });
  } catch (error) {
    console.error('SCBS post delete failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to delete post.' });
  }
});

// ============================================
// SCBS ISSUE REPORTS — public submit, admin-only review
// ============================================
const issueReportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many reports submitted. Please try again later.' }
});
const issueReviewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const issueCategories = new Set(['Suspicious activity', 'Technical problem', 'Order or payment', 'Other']);

app.post('/api/issue-reports', issueReportLimiter, (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const contact = typeof req.body?.contact === 'string' ? req.body.contact.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (name.length < 2 || name.length > 100) return res.status(400).json({ success: false, error: 'Name must be 2–100 characters.' });
    if (contact.length < 3 || contact.length > 254 || /[\r\n]/.test(contact)) return res.status(400).json({ success: false, error: 'Enter a valid phone number or email address.' });
    if (!issueCategories.has(category)) return res.status(400).json({ success: false, error: 'Choose a valid report category.' });
    if (description.length < 10 || description.length > 3000) return res.status(400).json({ success: false, error: 'Description must be 10–3000 characters.' });
    const referenceCode = `SCBS-ISS-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    db.prepare(`INSERT INTO scbs_issue_reports (reference_code, name, contact, category, description) VALUES (?, ?, ?, ?, ?)`).run(referenceCode, name, contact, category, description);
    return res.status(201).json({ success: true, reference_code: referenceCode, message: 'Your report was submitted privately. Keep the reference number for follow-up.' });
  } catch (error) {
    console.error('SCBS issue report submission failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to submit the report right now.' });
  }
});

app.get('/api/admin/issue-reports', requireAdmin, requirePermission('issues:read'), issueReviewLimiter, (_req, res) => {
  try {
    const reports = db.prepare(`SELECT id, reference_code, name, contact, category, description, status, admin_notes, created_at, updated_at FROM scbs_issue_reports ORDER BY created_at DESC, id DESC LIMIT 200`).all();
    return res.json({ success: true, reports });
  } catch (error) {
    console.error('SCBS issue report review failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load issue reports.' });
  }
});

app.patch('/api/admin/issue-reports/:id', requireAdmin, requirePermission('issues:write'), issueReviewLimiter, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'Invalid report ID.' });
    const status = req.body?.status;
    const notes = typeof req.body?.admin_notes === 'string' ? req.body.admin_notes.trim() : '';
    if (!['new', 'under_review', 'resolved'].includes(status)) return res.status(400).json({ success: false, error: 'Choose a valid report status.' });
    if (notes.length > 2000) return res.status(400).json({ success: false, error: 'Administrator notes must be 2000 characters or fewer.' });
    const result = db.prepare(`UPDATE scbs_issue_reports SET status = ?, admin_notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(status, notes || null, id);
    if (!result.changes) return res.status(404).json({ success: false, error: 'Report not found.' });
    return res.json({ success: true, message: 'Issue report updated.' });
  } catch (error) {
    console.error('SCBS issue report update failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to update the report.' });
  }
});

// SCBS application health check.
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'Sergio Chabu Business System',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/platform-info', (_req, res) => {
  res.json({
    name: 'Sergio Chabu Business System',
    shortName: 'SCBS',
    modules: ['Products', 'Multi-Tech Services', 'Advertisements', 'Customer Enquiries'],
    note: 'Starter scaffold: database and authentication are not connected yet.'
  });
});

// ============================================
// SCBS ADVERTISEMENT MANAGEMENT
// ============================================

// Admin: upload an advertisement image without entering an image URL.
app.post('/api/advertisements/image', requireAdmin, requirePermission('advertisements:write'), (req, res) => {
  advertisementImageUpload.single('image')(req, res, async (uploadError) => {
    if (uploadError) {
      const status = uploadError instanceof multer.MulterError ? 400 : 400;
      return res.status(status).json({ success: false, error: uploadError.message || 'Unable to upload advertisement image.' });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'Choose an advertisement image first.' });
    try {
      const type = ADVERTISEMENT_IMAGE_TYPES.get(req.file.mimetype);
      const bytes = await fs.readFile(req.file.path);
      const signatureOk = type && type.signature.every((byte, index) => bytes[index] === byte) &&
        (!type.extraSignature || type.extraSignature.every((byte, index) => bytes[index + 8] === byte));
      if (!signatureOk) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ success: false, error: 'The selected file is not a valid JPEG, PNG, or WebP image.' });
      }
      return res.status(201).json({ success: true, image_url: `/uploads/advertisement-images/${req.file.filename}` });
    } catch (error) {
      await fs.unlink(req.file.path).catch(() => {});
      console.error('SCBS advertisement image upload failed:', error.message);
      return res.status(500).json({ success: false, error: 'Unable to save advertisement image.' });
    }
  });
});

// Public: display advertisements eligible for publication.
app.get('/api/advertisements', (req, res) => {
  try {
    const advertisements = db.prepare(`
      SELECT id, ad_code, title, description, image_url,
             target_url, starts_at, ends_at, status
      FROM advertisements
      WHERE status = 'published'
        AND (starts_at IS NULL OR starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        AND (ends_at IS NULL OR ends_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ORDER BY created_at DESC
      LIMIT 100
    `).all();

    return res.json({ success: true, advertisements });
  } catch (error) {
    console.error('SCBS public advertisements failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to load advertisements.'
    });
  }
});

// Admin: list all advertisements, including drafts.
app.get('/api/admin/advertisements', requireAdmin, requirePermission('advertisements:read'), (req, res) => {
  try {
    const advertisements = db.prepare(`
      SELECT id, ad_code, title, description, image_url,
             target_url, starts_at, ends_at, status,
             created_at, updated_at
      FROM advertisements
      ORDER BY created_at DESC
      LIMIT 200
    `).all();

    return res.json({ success: true, advertisements });
  } catch (error) {
    console.error('SCBS admin advertisements failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to load advertisements.'
    });
  }
});

// Admin: create an advertisement.
app.post('/api/advertisements', requireAdmin, requirePermission('advertisements:write'), (req, res) => {
  try {
    const {
      ad_code, title, description, image_url,
      target_url, starts_at, ends_at, status
    } = req.body || {};

    if (
      typeof ad_code !== 'string' ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(ad_code.trim()) ||
      typeof title !== 'string' ||
      title.trim().length < 2 ||
      title.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        error: 'Enter an advertisement code (2–40 letters, numbers, _ or -) and a title (2–150 characters).'
      });
    }

    const validStatus = ['draft', 'published', 'paused'];
    const requestedStatus = status || 'draft';

    if (!validStatus.includes(requestedStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Status must be draft, published, or paused.'
      });
    }

    // The existing advertisements table CHECK constraint does not include
    // 'paused'. Store a paused promotion as 'draft' to avoid SQLite rejecting
    // the save; the admin can publish it again when ready.
    const chosenStatus = requestedStatus === 'paused' ? 'draft' : requestedStatus;

    const optionalText = (fieldName, value, max) => {
      if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
      if (typeof value !== 'string') {
        throw new Error(`${fieldName} must be text.`);
      }
      const cleaned = value.trim();
      if (cleaned.length > max) {
        throw new Error(`${fieldName} is too long (maximum ${max} characters).`);
      }
      return cleaned || null;
    };

    const imageUrl = optionalText('Image URL', image_url, 1000);
    const targetUrl = optionalText('Destination URL', target_url, 1000);
    const adDescription = optionalText('Description', description, 5000);
    const startsAt = optionalText('Start date', starts_at, 40);
    const endsAt = optionalText('End date', ends_at, 40);

    if (imageUrl && !(/^https?:\/\/\S+$/i.test(imageUrl) || /^\/uploads\/advertisement-images\/[A-Za-z0-9-]+\.(?:jpg|png|webp)$/i.test(imageUrl))) {
      return res.status(400).json({ success: false, error: 'Choose an uploaded image or provide a valid HTTPS image link.' });
    }
    if (targetUrl && !/^https?:\/\/\S+$/i.test(targetUrl)) {
      return res.status(400).json({ success: false, error: 'Destination URL must start with http:// or https://.' });
    }

    const result = db.prepare(`
      INSERT INTO advertisements (
        ad_code, title, description, image_url,
        target_url, starts_at, ends_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ad_code.trim(),
      title.trim(),
      adDescription,
      imageUrl,
      targetUrl,
      startsAt,
      endsAt,
      chosenStatus
    );

    return res.status(201).json({
      success: true,
      message: 'Advertisement created.',
      id: result.lastInsertRowid
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        success: false,
        error: 'That advertisement code already exists. Choose another.'
      });
    }

    if (/must be text|is too long/.test(error.message)) return res.status(400).json({ success: false, error: error.message });
    console.error('SCBS advertisement creation failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to create advertisement.'
    });
  }
});

// Admin: edit an advertisement.
app.put('/api/advertisements/:id', requireAdmin, requirePermission('advertisements:write'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      ad_code, title, description, image_url,
      target_url, starts_at, ends_at, status
    } = req.body || {};

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: 'Invalid advertisement ID.' });
    }

    if (
      typeof ad_code !== 'string' ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(ad_code.trim()) ||
      typeof title !== 'string' ||
      title.trim().length < 2 ||
      title.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        error: 'Enter a valid advertisement code and title.'
      });
    }

    if (!['draft', 'published', 'paused'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Status must be draft, published, or paused.'
      });
    }
    const databaseStatus = status === 'paused' ? 'draft' : status;

    const optionalText = (fieldName, value, max) => {
      if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
      if (typeof value !== 'string') {
        throw new Error(`${fieldName} must be text.`);
      }
      const cleaned = value.trim();
      if (cleaned.length > max) {
        throw new Error(`${fieldName} is too long (maximum ${max} characters).`);
      }
      return cleaned || null;
    };

    const imageUrl = optionalText('Image URL', image_url, 1000);
    const targetUrl = optionalText('Destination URL', target_url, 1000);
    const adDescription = optionalText('Description', description, 5000);
    const startsAt = optionalText('Start date', starts_at, 40);
    const endsAt = optionalText('End date', ends_at, 40);

    if (imageUrl && !(/^https?:\/\/\S+$/i.test(imageUrl) || /^\/uploads\/advertisement-images\/[A-Za-z0-9-]+\.(?:jpg|png|webp)$/i.test(imageUrl))) {
      return res.status(400).json({ success: false, error: 'Choose an uploaded image or provide a valid HTTPS image link.' });
    }
    if (targetUrl && !/^https?:\/\/\S+$/i.test(targetUrl)) {
      return res.status(400).json({ success: false, error: 'Destination URL must start with http:// or https://.' });
    }

    const result = db.prepare(`
      UPDATE advertisements
      SET ad_code = ?, title = ?, description = ?, image_url = ?,
          target_url = ?, starts_at = ?, ends_at = ?, status = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(
      ad_code.trim(),
      title.trim(),
      adDescription,
      imageUrl,
      targetUrl,
      startsAt,
      endsAt,
      databaseStatus,
      id
    );

    if (!result.changes) {
      return res.status(404).json({
        success: false,
        error: 'Advertisement not found.'
      });
    }

    return res.json({ success: true, message: 'Advertisement updated.' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        success: false,
        error: 'That advertisement code already exists.'
      });
    }

    if (/must be text|is too long/.test(error.message)) return res.status(400).json({ success: false, error: error.message });
    console.error('SCBS advertisement update failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to update advertisement.'
    });
  }
});

// Admin: pause or resume an advertisement.
app.patch('/api/advertisements/:id/status', requireAdmin, requirePermission('advertisements:write'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: 'Invalid advertisement ID.' });
    }

    if (!['draft', 'published', 'paused'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Status must be draft, published, or paused.'
      });
    }
    const databaseStatus = status === 'paused' ? 'draft' : status;

    const result = db.prepare(`
      UPDATE advertisements
      SET status = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(databaseStatus, id);

    if (!result.changes) {
      return res.status(404).json({
        success: false,
        error: 'Advertisement not found.'
      });
    }

    return res.json({ success: true, message: 'Advertisement status updated.' });
  } catch (error) {
    console.error('SCBS advertisement status update failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to update advertisement status.'
    });
  }
});
// ============================================
// SCBS BOOKS MANAGEMENT API
// ============================================

// Public: list published books.
app.get('/api/books', (req, res) => {
  try {
    const books = db.prepare(`
      SELECT id, book_code, title, author, description,
             category, format, price_ngwee, stock_quantity,
             cover_image_url, created_at, updated_at
      FROM books
      WHERE publication_status = 'published'
      ORDER BY created_at DESC
      LIMIT 200
    `).all();

    return res.json({
      success: true,
      count: books.length,
      books
    });
  } catch (error) {
    console.error('SCBS public books failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to load published books.'
    });
  }
});

// Administrator: list all books, including drafts and archived books.
app.get('/api/admin/books', requireAdmin, requirePermission('books:read'), (req, res) => {
  try {
    const books = db.prepare(`
      SELECT id, book_code, title, author, description,
             category, format, price_ngwee, stock_quantity,
             publication_status, cover_image_url,
             created_at, updated_at
      FROM books
      ORDER BY created_at DESC
      LIMIT 200
    `).all();

    return res.json({
      success: true,
      count: books.length,
      books
    });
  } catch (error) {
    console.error('SCBS admin books failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to load books.'
    });
  }
});// Administrator: upload a validated cover image for an existing book.
app.post(
  '/api/admin/books/:id/cover',
  requireAdmin,
  requirePermission('books:write'),
  (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid book ID.'
      });
    }

    const book = db.prepare(
      'SELECT id FROM books WHERE id = ?'
    ).get(id);

    if (!book) {
      return res.status(404).json({
        success: false,
        error: 'Book not found.'
      });
    }

    next();
  },
  (req, res, next) => {
    bookCoverUpload.single('cover')(req, res, (error) => {
      if (!error) return next();

      const status = error instanceof multer.MulterError
        ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        : 400;

      return res.status(status).json({
        success: false,
        error: error.code === 'LIMIT_FILE_SIZE'
          ? 'Cover image must not exceed 2 MB.'
          : error.message || 'Book-cover upload failed.'
      });
    });
  },
  async (req, res) => {
    let uploadedPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Choose a cover image first.'
        });
      }

      uploadedPath = req.file.path;

      const fs = await import('node:fs/promises');
      const bytes = await fs.readFile(uploadedPath);
      const type = BOOK_COVER_TYPES.get(req.file.mimetype);

      const signatureMatches = type &&
        type.signature.every((byte, index) => bytes[index] === byte);

      const webpMatches = type?.extraSignature
        ? type.extraSignature.every(
            (byte, index) => bytes[index + 8] === byte
          )
        : true;

      if (
        !signatureMatches ||
        !webpMatches ||
        (req.file.mimetype === 'image/png' &&
          bytes.subarray(12, 16).toString('ascii') !== 'IHDR') ||
        (req.file.mimetype === 'image/webp' &&
          bytes.length < 12) ||
        (req.file.mimetype === 'image/jpeg' &&
          bytes[bytes.length - 2] !== 0xff)
      ) {
        await fs.unlink(uploadedPath).catch(() => {});

        return res.status(400).json({
          success: false,
          error: 'The uploaded file is not a valid supported image.'
        });
      }

      const coverUrl =
        `/uploads/book-covers/${req.file.filename}`;

      db.prepare(`
        UPDATE books
        SET cover_image_url = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(coverUrl, Number(req.params.id));

      return res.json({
        success: true,
        message: 'Book cover uploaded successfully.',
        cover_image_url: coverUrl
      });
    } catch (error) {
      console.error('SCBS book-cover upload failed:', error.message);

      if (uploadedPath) {
        const fs = await import('node:fs/promises');
        await fs.unlink(uploadedPath).catch(() => {});
      }

      return res.status(500).json({
        success: false,
        error: 'Unable to save the book cover.'
      });
    }
  }
);

// Administrator: create a book.
app.post('/api/books', requireAdmin, requirePermission('books:write'), (req, res) => {
  try {
    const {
      book_code,
      title,
      author = 'Sergio Chabu',
      description = '',
      category = '',
      format = 'print',
      price_ngwee = 0,
      stock_quantity = 0,
      publication_status = 'draft',
      cover_image_url = null
    } = req.body || {};

    const allowedFormats = ['print', 'digital', 'both'];
    const allowedStatuses = ['draft', 'published', 'archived'];

    if (
      typeof book_code !== 'string' ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(book_code.trim())
    ) {
      return res.status(400).json({
        success: false,
        error: 'Book code must contain 2-40 letters, numbers, underscores or hyphens.'
      });
    }

    if (
      typeof title !== 'string' ||
      title.trim().length < 2 ||
      title.trim().length > 200
    ) {
      return res.status(400).json({
        success: false,
        error: 'Book title must contain 2-200 characters.'
      });
    }

    if (
      typeof author !== 'string' ||
      author.trim().length < 2 ||
      author.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        error: 'Author must contain 2-150 characters.'
      });
    }

    if (
      typeof description !== 'string' ||
      description.length > 5000 ||
      typeof category !== 'string' ||
      category.length > 100
    ) {
      return res.status(400).json({
        success: false,
        error: 'Description or category is too long or invalid.'
      });
    }

    if (!allowedFormats.includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'Format must be print, digital, or both.'
      });
    }

    if (
      !Number.isSafeInteger(price_ngwee) ||
      price_ngwee < 0 ||
      !Number.isSafeInteger(stock_quantity) ||
      stock_quantity < 0
    ) {
      return res.status(400).json({
        success: false,
        error: 'Price and stock must be non-negative whole numbers.'
      });
    }

    if (!allowedStatuses.includes(publication_status)) {
      return res.status(400).json({
        success: false,
        error: 'Status must be draft, published, or archived.'
      });
    }

    if (
      cover_image_url !== null &&
      (
        typeof cover_image_url !== 'string' ||
        cover_image_url.length > 1000
      )
    ) {
      return res.status(400).json({
        success: false,
        error: 'Cover image URL must be text of no more than 1000 characters.'
      });
    }

    const result = db.prepare(`
      INSERT INTO books (
        book_code, title, author, description, category,
        format, price_ngwee, stock_quantity,
        publication_status, cover_image_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      book_code.trim(),
      title.trim(),
      author.trim(),
      description.trim(),
      category.trim(),
      format,
      price_ngwee,
      stock_quantity,
      publication_status,
      cover_image_url ? cover_image_url.trim() : null
    );

    const book = db.prepare(`
      SELECT * FROM books WHERE id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json({
      success: true,
      message: 'Book saved successfully.',
      book
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        success: false,
        error: 'That book code already exists.'
      });
    }

    console.error('SCBS book creation failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to save the book.'
    });
  }
});

// Administrator: edit an existing book.
app.put('/api/books/:id', requireAdmin, requirePermission('books:write'), (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid book ID.'
      });
    }

    const existing = db.prepare(
      'SELECT id FROM books WHERE id = ?'
    ).get(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Book not found.'
      });
    }

    const {
      book_code,
      title,
      author = 'Sergio Chabu',
      description = '',
      category = '',
      format = 'print',
      price_ngwee = 0,
      stock_quantity = 0,
      publication_status = 'draft',
      cover_image_url = null
    } = req.body || {};

    const allowedFormats = ['print', 'digital', 'both'];
    const allowedStatuses = ['draft', 'published', 'archived'];

    if (
      typeof book_code !== 'string' ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(book_code.trim()) ||
      typeof title !== 'string' ||
      title.trim().length < 2 ||
      title.trim().length > 200 ||
      typeof author !== 'string' ||
      author.trim().length < 2 ||
      author.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid book code, title, or author.'
      });
    }

    if (
      typeof description !== 'string' ||
      description.length > 5000 ||
      typeof category !== 'string' ||
      category.length > 100 ||
      !allowedFormats.includes(format) ||
      !allowedStatuses.includes(publication_status) ||
      !Number.isSafeInteger(price_ngwee) ||
      price_ngwee < 0 ||
      !Number.isSafeInteger(stock_quantity) ||
      stock_quantity < 0
    ) {
      return res.status(400).json({
        success: false,
        error: 'One or more book fields are invalid.'
      });
    }

    if (
      cover_image_url !== null &&
      (
        typeof cover_image_url !== 'string' ||
        cover_image_url.length > 1000
      )
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid cover image URL.'
      });
    }

    db.prepare(`
      UPDATE books
      SET book_code = ?,
          title = ?,
          author = ?,
          description = ?,
          category = ?,
          format = ?,
          price_ngwee = ?,
          stock_quantity = ?,
          publication_status = ?,
          cover_image_url = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(
      book_code.trim(),
      title.trim(),
      author.trim(),
      description.trim(),
      category.trim(),
      format,
      price_ngwee,
      stock_quantity,
      publication_status,
      cover_image_url ? cover_image_url.trim() : null,
      id
    );

    const book = db.prepare(
      'SELECT * FROM books WHERE id = ?'
    ).get(id);

    return res.json({
      success: true,
      message: 'Book updated successfully.',
      book
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        success: false,
        error: 'That book code already exists.'
      });
    }

    console.error('SCBS book update failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to update the book.'
    });
  }
});

// Administrator: publish, return to draft, or archive a book.
app.patch('/api/books/:id/status', requireAdmin, requirePermission('books:write'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const { publication_status } = req.body || {};

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid book ID.'
      });
    }

    if (!['draft', 'published', 'archived'].includes(publication_status)) {
      return res.status(400).json({
        success: false,
        error: 'Status must be draft, published, or archived.'
      });
    }

    const result = db.prepare(`
      UPDATE books
      SET publication_status = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(publication_status, id);

    if (!result.changes) {
      return res.status(404).json({
        success: false,
        error: 'Book not found.'
      });
    }

    return res.json({
      success: true,
      message: 'Book publication status updated.'
    });
  } catch (error) {
    console.error('SCBS book status update failed:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to update book status.'
    });
  }
});// ============================================
// SCBS CUSTOMER PROFILE-PICTURE UPLOAD API
// ============================================
app.post(
  '/api/customer/profile-picture',
  requireCustomer,
  (req, res, next) => {
    customerProfileUpload.single('picture')(req, res, (error) => {
      if (!error) return next();

      const status = error instanceof multer.MulterError
        ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        : 400;

      return res.status(status).json({
        success: false,
        error: error.code === 'LIMIT_FILE_SIZE'
          ? 'Profile picture must not exceed 2 MB.'
          : error.message || 'Profile-picture upload failed.'
      });
    });
  },
  async (req, res) => {
    let uploadedPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Choose a profile picture first.'
        });
      }

      uploadedPath = req.file.path;

      const fs = await import('node:fs/promises');
      const bytes = await fs.readFile(uploadedPath);
      const type = CUSTOMER_PROFILE_TYPES.get(req.file.mimetype);

      const signatureMatches = type &&
        type.signature.every((byte, index) => bytes[index] === byte);

      const webpMatches = type?.extraSignature
        ? type.extraSignature.every(
            (byte, index) => bytes[index + 8] === byte
          )
        : true;

      if (
        !signatureMatches ||
        !webpMatches ||
        (req.file.mimetype === 'image/png' &&
          bytes.subarray(12, 16).toString('ascii') !== 'IHDR') ||
        (req.file.mimetype === 'image/webp' &&
          bytes.length < 12) ||
        (req.file.mimetype === 'image/jpeg' &&
          (bytes.length < 4 ||
           bytes[bytes.length - 2] !== 0xff ||
           bytes[bytes.length - 1] !== 0xd9))
      ) {
        await fs.unlink(uploadedPath).catch(() => {});
        uploadedPath = null;

        return res.status(400).json({
          success: false,
          error: 'The uploaded file is not a valid supported image.'
        });
      }

      const profilePictureUrl =
        `/uploads/customer-profiles/${req.file.filename}`;

      db.prepare(`
        UPDATE customers
        SET profile_picture_url = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'active'
      `).run(profilePictureUrl, req.customer.id);

      return res.json({
        success: true,
        message: 'Profile picture uploaded successfully.',
        profile_picture_url: profilePictureUrl
      });
    } catch (error) {
      console.error(
        'SCBS customer profile-picture upload failed:',
        error.message
      );

      if (uploadedPath) {
        const fs = await import('node:fs/promises');
        await fs.unlink(uploadedPath).catch(() => {});
      }

      return res.status(500).json({
        success: false,
        error: 'Unable to save the profile picture.'
      });
    }
  }
);

// ============================================
// END SCBS CUSTOMER PROFILE-PICTURE UPLOAD API
// ============================================

// Ensure SCBS upload directories exist before the server starts
await fs.mkdir(BOOK_COVER_DIR, { recursive: true });
await fs.mkdir(CUSTOMER_PROFILE_DIR, { recursive: true });
// ============================================
// SCBS: Secure administrator upload for rental-tool pictures.
app.post(
  '/api/admin/rentals/:id/image',
  requireAdmin,
  requirePermission('products:write'),
  (req, res, next) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid rental tool ID.'
      });
    }

    const rental = db.prepare(
      'SELECT id FROM rental_items WHERE id = ?'
    ).get(id);

    if (!rental) {
      return res.status(404).json({
        success: false,
        error: 'Rental tool not found.'
      });
    }

    next();
  },
  (req, res, next) => {
    rentalImageUpload.single('image')(req, res, (error) => {
      if (!error) return next();

      const status = error instanceof multer.MulterError
        ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        : 400;

      return res.status(status).json({
        success: false,
        error: error.code === 'LIMIT_FILE_SIZE'
          ? 'Rental picture must not exceed 2 MB.'
          : error.message || 'Rental picture upload failed.'
      });
    });
  },
  async (req, res) => {
    let uploadedPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Choose a rental picture first.'
        });
      }

      uploadedPath = req.file.path;
      const bytes = await fs.readFile(uploadedPath);
      const type = RENTAL_IMAGE_TYPES.get(req.file.mimetype);

      const signatureMatches = Boolean(type) &&
        type.signature.every((byte, index) => bytes[index] === byte);

      const webpMatches = type?.extraSignature
        ? type.extraSignature.every(
            (byte, index) => bytes[index + 8] === byte
          )
        : true;

      const pngMatches =
        req.file.mimetype !== 'image/png' ||
        (bytes.length >= 16 &&
          bytes.subarray(12, 16).toString('ascii') === 'IHDR');

      const webpLengthMatches =
        req.file.mimetype !== 'image/webp' || bytes.length >= 12;

      const jpegMatches =
        req.file.mimetype !== 'image/jpeg' ||
        (bytes.length >= 4 &&
          bytes[bytes.length - 2] === 0xff &&
          bytes[bytes.length - 1] === 0xd9);

      if (
        !signatureMatches ||
        !webpMatches ||
        !pngMatches ||
        !webpLengthMatches ||
        !jpegMatches
      ) {
        await fs.unlink(uploadedPath).catch(() => {});
        uploadedPath = null;

        return res.status(400).json({
          success: false,
          error: 'The uploaded file is not a valid supported image.'
        });
      }

      const imageUrl =
        `/uploads/rental-tools/${req.file.filename}`;

      const result = db.prepare(`
        UPDATE rental_items
        SET image_url = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(imageUrl, Number(req.params.id));

      if (result.changes !== 1) {
        await fs.unlink(uploadedPath).catch(() => {});
        uploadedPath = null;

        return res.status(404).json({
          success: false,
          error: 'Rental tool not found.'
        });
      }

      return res.json({
        success: true,
        message: 'Rental picture uploaded successfully.',
        image_url: imageUrl
      });
    } catch (error) {
      console.error('SCBS rental-picture upload failed:', error.message);

      if (uploadedPath) {
        await fs.unlink(uploadedPath).catch(() => {});
      }

      return res.status(500).json({
        success: false,
        error: 'Unable to save the rental picture.'
      });
    }
  }
);

// SCBS RENTAL MANAGEMENT ROUTES
// ============================================
registerRentalRoutes({
  app,
  db,
  requireAdmin,
  requireCustomer,
  requirePermission
});
// SCBS AI ASSISTANT — public, read-only help
// Uses only published public SCBS catalogue data.
// OPENAI_API_KEY must remain in the server environment.
// ============================================
const scbsAiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'SCBS AI has received too many questions. Please wait a little and try again.'
  }
});

function getScbsAiPublicReferenceData() {
  const safeQuery = (sql) => {
    try {
      return db.prepare(sql).all();
    } catch (error) {
      console.error('SCBS AI public reference query failed:', error.message);
      return [];
    }
  };

  return {
    products: safeQuery(`
      SELECT sku, name, description, product_type, price_ngwee, stock_quantity
      FROM products
      WHERE is_active = 1
      ORDER BY name COLLATE NOCASE
      LIMIT 30
    `),
    services: safeQuery(`
      SELECT service_code, name, category, description, price_ngwee, pricing_type, estimated_duration
      FROM services
      WHERE is_active = 1
      ORDER BY name COLLATE NOCASE
      LIMIT 30
    `),
    books: safeQuery(`
      SELECT title, author, description, category, format, price_ngwee, stock_quantity
      FROM books
      WHERE publication_status = 'published'
      ORDER BY created_at DESC
      LIMIT 30
    `),
    advertisements: safeQuery(`
      SELECT title, description, starts_at, ends_at
      FROM advertisements
      WHERE status = 'published'
        AND (starts_at IS NULL OR starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        AND (ends_at IS NULL OR ends_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ORDER BY created_at DESC
      LIMIT 20
    `),
    rentals: safeQuery(`
      SELECT item_code, name, description, hourly_rate_ngwee, daily_rate_ngwee,
             available_quantity, condition_status
      FROM rental_items
      ORDER BY name COLLATE NOCASE
      LIMIT 30
    `)
  };
}

app.post('/api/ai-assistant', scbsAiLimiter, (req, res) => {
  const question = typeof req.body?.question === 'string'
    ? req.body.question.trim()
    : '';

  if (question.length < 2 || question.length > 1000) {
    return res.status(400).json({
      success: false,
      error: 'Please enter a question between 2 and 1000 characters.'
    });
  }

  const q = question.toLowerCase();
  const data = getScbsAiPublicReferenceData();
  const money = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? `K${(amount / 100).toFixed(2)}`
      : 'Price not listed';
  };

  let answer;

  if (/\b(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(q)) {
    answer = 'Hello! Welcome to Sergio Chabu Business System (SCBS). I can help you find products, services, books and promotions.';
  } else if (/\b(product|products|phone|phones|accessor|accessories|stock|available items|sku|itel|samsung|grocery|groceries|price|prices|cost|how much)\b/.test(q) && !/\b(service|services|repair|reapair|troubleshoot|troubleshooting|computer|software|restore|nvram|files|rent|rental|rentals|tools|booking|hourly|daily|unlock|hydra|eft)\b/.test(q)) {
    const allItems = data.products || [];
    const terms = q
      .replace(/\b(show|find|search|list|have|has|do|you|your|the|a|an|for|me|please|what|which|is|are|price|prices|cost|much|how|available|availability|product|products|phone|phones|accessory|accessories|stock|sku|of|in|on|sell|selling|tell|give|want|know|does|with)\b/g, ' ')
      .split(/[^a-z0-9-]+/)
      .filter(term => term.length >= 2);

    const skuQuery = q.match(/\b(sku-[a-z0-9-]+)\b/i);
    const requestedSku = skuQuery ? skuQuery[1].toLowerCase() : null;

    const exactSkuMatches = requestedSku
      ? allItems.filter(p => (p.sku || '').toLowerCase() === requestedSku)
      : [];

    const exactNameMatches = allItems.filter(p =>
      (p.name || '').toLowerCase() === q.trim()
    );

    const matches = exactSkuMatches.length
      ? exactSkuMatches
      : exactNameMatches.length
        ? exactNameMatches
        : (() => {
            const searchableTerms = terms.filter(term =>
              !['car', 'cars', 'flying'].includes(term)
            );

            if (searchableTerms.length === 0) return [];

            const categoryTerms = {
              grocery: ['grocery', 'groceries'],
              groceries: ['grocery', 'groceries'],
              phone: ['phone', 'phones'],
              phones: ['phone', 'phones'],
              accessory: ['accessory', 'accessories'],
              accessories: ['accessory', 'accessories']
            };

            const requestedCategories = searchableTerms.flatMap(term =>
              categoryTerms[term] || []
            );

            return allItems.filter(p => {
              const nameAndSku = `${p.name || ''} ${p.sku || ''}`.toLowerCase();
              const searchable = `${nameAndSku} ${p.product_type || ''} ${p.description || ''}`.toLowerCase();

              if (requestedCategories.length > 0) {
                return requestedCategories.some(category =>
                  `${p.product_type || ''} ${p.name || ''} ${p.description || ''}`
                    .toLowerCase()
                    .includes(category === 'groceries' ? 'grocery' : category)
                );
              }

              const matchedNameOrSku = searchableTerms.some(term =>
                nameAndSku.includes(term)
              );

              const matchedTerms = searchableTerms.filter(term =>
                searchable.includes(term)
              );

              return matchedNameOrSku &&
                matchedTerms.length >= Math.min(2, searchableTerms.length);
            });
          })();

    answer = matches.length
      ? 'SCBS product search results:\n' + matches.slice(0, 10).map(p =>
          `- ${p.name || 'Unnamed product'} | SKU: ${p.sku || 'not listed'} | Price: ${money(p.price_ngwee)} | Recorded stock: ${p.stock_quantity ?? 'not listed'}`
        ).join('\n') +
        '\nPrices and stock may change. Please contact SCBS to confirm availability.'
      : 'I could not find a matching product in the published SCBS catalogue. Try the product name or SKU, or contact SCBS through the Talk to Us section.';
  } else if (/\b(service|services|repair|reapair|troubleshoot|troubleshooting|computer|software|multi.?tech|flashing|restore|nvram|files)\b/.test(q)) {
    const allServices = data.services || [];
    const serviceTerms = q
      .replace(/\b(show|find|search|list|have|you|your|the|a|an|for|me|please|what|which|is|are|price|prices|cost|much|how|available|service|services|repair|reapair|troubleshooting|troubleshoot|software|multi.?tech|of|in|on|do|does|offer|offers|provide|provides|can|scbs|tell|about)\b/g, ' ')
      .split(/[^a-z0-9-]+/)
      .filter(term => term.length >= 2);

    const matchingServices = allServices.filter(s => {
      const searchable = `${s.service_code || ''} ${s.name || ''} ${s.category || ''} ${s.description || ''}`.toLowerCase();
      return serviceTerms.length === 0 || serviceTerms.some(term => searchable.includes(term));
    });

    const selectedServices = matchingServices.length
      ? matchingServices
      : (serviceTerms.length === 0 ? allServices : []);

    answer = selectedServices.length
      ? 'SCBS service search results:\n' + selectedServices.slice(0, 10).map(s =>
          `- ${s.name || 'Unnamed service'} | Code: ${s.service_code || 'not listed'} | ${s.description || 'Description not provided'} | Price: ${money(s.price_ngwee)}${s.pricing_type === 'from' ? ' (starting price)' : s.pricing_type === 'fixed' ? ' (fixed price)' : ''}`
        ).join('\n') +
        '\nPlease contact SCBS to confirm the final charge and service availability.'
      : `I couldn't find a matching service for "${question}". Try a service name or code, or contact SCBS through the Talk to Us section.`;
  } else if (/\b(book|books|author|reading)\b/.test(q)) {
    const items = data.books || [];
    answer = items.length
      ? 'SCBS books:\n' + items.slice(0, 10).map(b =>
          `• ${b.title || 'Untitled book'} by ${b.author || 'Author not listed'} — ${money(b.price_ngwee)}${b.description ? `; ${b.description}` : ''}`
        ).join('\n')
      : 'I could not find published books in the catalogue right now. Please contact SCBS for more information.';
  } else if (/\b(advert|advertisement|promotion|promotions|offer|offers|discount)\b/.test(q)) {
    const items = data.advertisements || [];
    answer = items.length
      ? 'Published SCBS promotions:\n' + items.slice(0, 10).map(a =>
          `• ${a.title || 'Promotion'}${a.description ? ` — ${a.description}` : ''}${a.target_url ? ` — ${a.target_url}` : ''}`
        ).join('\n')
      : 'No currently published promotions were found. Please check the SCBS website again later.';
  } else if (/\b(rent|rental|rentals|tool|tools|booking|hour|hourly|day|daily|unlock|hydra|eft)\b/.test(q)) {
    const allRentals = data.rentals || [];
    const rentalTerms = q
      .replace(/\b(show|list|find|search|what|which|are|is|the|a|an|for|me|please|available|availability|can|i|you|your|do|have|has|how|much|many|price|prices|cost|costs|rent|rental|rentals|tool|tools|hourly|daily|rate|rates|per|hour|day|booking|book|today|quantity|quantities|item|items|of|in|on|at|scbs)\b/g, ' ')
      .split(/[^a-z0-9-]+/)
      .filter(term => term.length >= 2);

    const namedRentals = rentalTerms.length
      ? allRentals.filter(r => {
          const searchable = `${r.item_code || ''} ${r.name || ''} ${r.description || ''}`.toLowerCase();
          return rentalTerms.some(term => searchable.includes(term));
        })
      : [];

    const selectedRentals = namedRentals.length ? namedRentals : (rentalTerms.length ? [] : allRentals);

    if (!allRentals.length) {
      answer = 'I could not retrieve the SCBS rental catalogue right now. Please visit the Tool Rentals section or contact SCBS.';
    } else if (rentalTerms.length && !selectedRentals.length) {
      answer = 'I could not find a matching item in the SCBS rental catalogue. Please explore the Tool Rentals section or contact SCBS.';
    } else if (/\b(book|booking|reserve|reservation|today)\b/.test(q)) {
      answer = 'The SCBS rental catalogue lists these items, but I cannot confirm live booking availability. Please contact SCBS to check availability and arrange a booking:\n' +
        selectedRentals.map(r => `- ${r.name} | Code: ${r.item_code} | Recorded quantity: ${r.available_quantity}`).join('\n');
    } else {
      answer = '🛠️ SCBS Tool Rentals — explore our listed items:\n' +
        selectedRentals.map(r =>
          `- ${r.name || 'Unnamed item'} | Code: ${r.item_code || 'not listed'} | Hourly: ${money(r.hourly_rate_ngwee)} | Daily: ${money(r.daily_rate_ngwee)} | Recorded quantity: ${r.available_quantity ?? 'not listed'} | Condition: ${r.condition_status || 'not listed'}`
        ).join('\n') +
        '\nThese are catalogue records. Please contact SCBS to confirm current availability, rates and booking conditions.';
    }
  } else if (/\b(contact|talk to us|talk to scbs|message|support|help)\b/.test(q)) {
    answer = 'You can use the Talk to Us section on the SCBS website to send a message or ask for assistance. Do not send passwords, PINs or payment credentials.';
  } else if (/\b(price|prices|cost|how much)\b/.test(q)) {
    answer = 'I can show prices listed in the published SCBS product, service and book catalogues. Please mention the specific product, service or book you want to check.';
  } else {
    answer = 'I am the SCBS Local Assistant. I can help with published products, services, books, promotions, rentals and contacting SCBS. Please ask about one of these topics. I use programmed responses, so I may not understand every question.';
  }

  return res.json({
    success: true,
    answer,
    mode: 'local',
    disclaimer: 'Programmed assistant; information is based on published catalogue data.'
  });
});

// ============================================
// SCBS VIDEO LIBRARY (YouTube links; no server video uploads)
// ============================================
function getSCBSYouTubeVideoId(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length > 1000) return null;
  let parsed;
  try { parsed = new URL(rawUrl.trim()); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let id = '';
  if (host === 'youtu.be') {
    id = parsed.pathname.split('/').filter(Boolean)[0] || '';
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') id = parsed.searchParams.get('v') || '';
    else {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1] || '';
    }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function scbsVideoInput(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : 'General';
  const youtubeUrl = typeof body.youtube_url === 'string' ? body.youtube_url.trim() : '';
  const status = body.status || 'draft';
  if (title.length < 2 || title.length > 150) return { error: 'Video title must be between 2 and 150 characters.' };
  if (description.length > 5000) return { error: 'Video description must be 5000 characters or fewer.' };
  if (category.length < 2 || category.length > 80) return { error: 'Choose a category between 2 and 80 characters.' };
  const videoId = getSCBSYouTubeVideoId(youtubeUrl);
  if (!videoId) return { error: 'Enter a valid YouTube video link (youtube.com or youtu.be).' };
  if (!['draft', 'published', 'paused'].includes(status)) return { error: 'Status must be draft, published, or paused.' };
  return { value: { title, description, category, youtubeUrl, videoId, status } };
}

app.get('/api/videos', (_req, res) => {
  try {
    const videos = db.prepare(`
      SELECT id, title, description, category, youtube_url, youtube_video_id, published_at, created_at
      FROM scbs_videos
      WHERE status = 'published'
      ORDER BY COALESCE(published_at, created_at) DESC, id DESC
      LIMIT 200
    `).all();
    return res.json({ success: true, videos });
  } catch (error) {
    console.error('SCBS public videos failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load SCBS videos.' });
  }
});

app.get('/api/admin/videos', requireAdmin, requirePermission('advertisements:read'), (_req, res) => {
  try {
    const videos = db.prepare(`
      SELECT id, title, description, category, youtube_url, youtube_video_id, status, created_at, updated_at, published_at
      FROM scbs_videos
      ORDER BY updated_at DESC, id DESC
      LIMIT 300
    `).all();
    return res.json({ success: true, videos });
  } catch (error) {
    console.error('SCBS admin videos failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load SCBS videos.' });
  }
});

app.post('/api/admin/videos', requireAdmin, requirePermission('advertisements:write'), (req, res) => {
  try {
    const parsed = scbsVideoInput(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
    const v = parsed.value;
    const result = db.prepare(`
      INSERT INTO scbs_videos
        (title, description, category, youtube_url, youtube_video_id, status, created_by, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END)
    `).run(v.title, v.description, v.category, v.youtubeUrl, v.videoId, v.status, req.admin.id, v.status);
    return res.status(201).json({ success: true, message: 'SCBS video saved.', id: result.lastInsertRowid });
  } catch (error) {
    console.error('SCBS video creation failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to save the SCBS video.' });
  }
});

app.put('/api/admin/videos/:id', requireAdmin, requirePermission('advertisements:write'), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'Invalid video ID.' });
    const parsed = scbsVideoInput(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
    const v = parsed.value;
    const result = db.prepare(`
      UPDATE scbs_videos
      SET title = ?, description = ?, category = ?, youtube_url = ?, youtube_video_id = ?,
          status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          published_at = CASE
            WHEN ? = 'published' THEN COALESCE(published_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            ELSE NULL
          END
      WHERE id = ?
    `).run(v.title, v.description, v.category, v.youtubeUrl, v.videoId, v.status, v.status, id);
    if (!result.changes) return res.status(404).json({ success: false, error: 'Video not found.' });
    return res.json({ success: true, message: 'SCBS video updated.' });
  } catch (error) {
    console.error('SCBS video update failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to update the SCBS video.' });
  }
});

app.delete('/api/admin/videos/:id', requireAdmin, requirePermission('advertisements:write'), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'Invalid video ID.' });
    const result = db.prepare('DELETE FROM scbs_videos WHERE id = ?').run(id);
    if (!result.changes) return res.status(404).json({ success: false, error: 'Video not found.' });
    return res.json({ success: true, message: 'SCBS video deleted.' });
  } catch (error) {
    console.error('SCBS video deletion failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to delete the SCBS video.' });
  }
});


// SCBS BOOK LOGISTICS API: additive schema and routes; existing SCBS data is preserved.
db.exec(`
  CREATE TABLE IF NOT EXISTS scbs_logistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    carrier_name TEXT NOT NULL CHECK(length(carrier_name) BETWEEN 2 AND 120),
    carrier_phone TEXT NOT NULL CHECK(length(carrier_phone) BETWEEN 3 AND 40),
    vehicle_plate TEXT NOT NULL CHECK(length(vehicle_plate) BETWEEN 2 AND 30),
    vehicle_image_url TEXT,
    driver_image_url TEXT,
    cargo_type TEXT NOT NULL CHECK(length(cargo_type) BETWEEN 2 AND 80),
    price_per_kg_zmw REAL NOT NULL CHECK(price_per_kg_zmw >= 0),
    description TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS scbs_logistics_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logistics_id INTEGER NOT NULL REFERENCES scbs_logistics(id),
    customer_name TEXT NOT NULL CHECK(length(customer_name) BETWEEN 2 AND 120),
    customer_email TEXT NOT NULL CHECK(length(customer_email) BETWEEN 5 AND 254),
    customer_phone TEXT NOT NULL CHECK(length(customer_phone) BETWEEN 3 AND 40),
    cargo_type TEXT NOT NULL,
    weight_kg REAL NOT NULL CHECK(weight_kg > 0 AND weight_kg <= 1000000),
    rate_per_kg_zmw REAL NOT NULL CHECK(rate_per_kg_zmw >= 0),
    estimated_total_zmw REAL NOT NULL CHECK(estimated_total_zmw >= 0),
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','in_transit','completed','cancelled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS scbs_logistics_active_idx ON scbs_logistics(is_active, cargo_type);
  CREATE INDEX IF NOT EXISTS scbs_logistics_bookings_date_idx ON scbs_logistics_bookings(created_at DESC);
  CREATE INDEX IF NOT EXISTS scbs_logistics_bookings_status_idx ON scbs_logistics_bookings(status, created_at DESC);
`);

function scbsLogisticsText(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function scbsLogisticsImageUrl(value) {
  const text = scbsLogisticsText(value, 1000);
  if (!text) return '';
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? text : null;
  } catch { return null; }
}
function scbsLogisticsAdmin(req, res, next) {
  return requireAdmin(req, res, next);
}
app.get('/api/logistics', (_req, res) => {
  try {
    const rows = db.prepare(`SELECT id, carrier_name, carrier_phone, vehicle_plate,
      vehicle_image_url, driver_image_url, cargo_type, price_per_kg_zmw, description
      FROM scbs_logistics WHERE is_active = 1 ORDER BY cargo_type, carrier_name`).all();
    res.json({ success: true, logistics: rows });
  } catch (error) {
    console.error('SCBS public logistics error:', error);
    res.status(500).json({ success: false, error: 'Unable to load book logistics right now.' });
  }
});
app.post('/api/logistics/bookings', (req, res) => {
  try {
    const logisticsId = Number(req.body?.logistics_id);
    const name = scbsLogisticsText(req.body?.customer_name, 120);
    const email = scbsLogisticsText(req.body?.customer_email, 254).toLowerCase();
    const phone = scbsLogisticsText(req.body?.customer_phone, 40);
    const cargoType = scbsLogisticsText(req.body?.cargo_type, 80);
    const weight = Number(req.body?.weight_kg);
    const notes = scbsLogisticsText(req.body?.notes, 1000);
    if (!Number.isInteger(logisticsId) || logisticsId < 1 || name.length < 2 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 3 ||
        cargoType.length < 2 || !Number.isFinite(weight) || weight <= 0 || weight > 1000000) {
      return res.status(400).json({ success: false, error: 'Please provide valid contact details, cargo type and weight in kg.' });
    }
    const option = db.prepare(`SELECT id, cargo_type, price_per_kg_zmw FROM scbs_logistics WHERE id = ? AND is_active = 1`).get(logisticsId);
    if (!option) return res.status(404).json({ success: false, error: 'This logistics option is no longer available.' });
    if (cargoType !== option.cargo_type) return res.status(400).json({ success: false, error: 'Cargo type does not match the selected logistics option.' });
    const total = Math.round(weight * Number(option.price_per_kg_zmw) * 100) / 100;
    const result = db.prepare(`INSERT INTO scbs_logistics_bookings
      (logistics_id, customer_name, customer_email, customer_phone, cargo_type, weight_kg, rate_per_kg_zmw, estimated_total_zmw, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(logisticsId, name, email, phone, cargoType, weight,
      Number(option.price_per_kg_zmw), total, notes);
    res.status(201).json({ success: true, booking_id: result.lastInsertRowid, estimated_total_zmw: total,
      message: 'Booking request submitted. SCBS will contact you to confirm availability and final charges.' });
  } catch (error) {
    console.error('SCBS logistics booking error:', error);
    res.status(500).json({ success: false, error: 'Unable to submit this booking. Please try again.' });
  }
});
app.get('/api/admin/logistics', scbsLogisticsAdmin, (_req, res) => {
  try {
    const logistics = db.prepare('SELECT * FROM scbs_logistics ORDER BY is_active DESC, created_at DESC').all();
    const bookings = db.prepare(`SELECT b.*, l.carrier_name, l.carrier_phone, l.vehicle_plate
      FROM scbs_logistics_bookings b LEFT JOIN scbs_logistics l ON l.id = b.logistics_id
      ORDER BY b.created_at DESC LIMIT 500`).all();
    res.json({ success: true, logistics, bookings });
  } catch (error) {
    console.error('SCBS admin logistics error:', error);
    res.status(500).json({ success: false, error: 'Unable to load logistics management.' });
  }
});
app.post('/api/admin/logistics', scbsLogisticsAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const carrier = scbsLogisticsText(body.carrier_name, 120);
    const phone = scbsLogisticsText(body.carrier_phone, 40);
    const plate = scbsLogisticsText(body.vehicle_plate, 30).toUpperCase();
    const cargo = scbsLogisticsText(body.cargo_type, 80);
    const description = scbsLogisticsText(body.description, 1000);
    const rate = Number(body.price_per_kg_zmw);
    const vehicleImage = scbsLogisticsImageUrl(body.vehicle_image_url);
    const driverImage = scbsLogisticsImageUrl(body.driver_image_url);
    if (carrier.length < 2 || phone.length < 3 || plate.length < 2 || cargo.length < 2 || !Number.isFinite(rate) || rate < 0 || rate > 100000000 || vehicleImage === null || driverImage === null) {
      return res.status(400).json({ success: false, error: 'Check carrier, phone, plate, cargo, price per kg and image URLs. Images must use http or https URLs.' });
    }
    const result = db.prepare(`INSERT INTO scbs_logistics
      (carrier_name, carrier_phone, vehicle_plate, vehicle_image_url, driver_image_url, cargo_type, price_per_kg_zmw, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(carrier, phone, plate, vehicleImage, driverImage, cargo, rate, description);
    res.status(201).json({ success: true, id: result.lastInsertRowid, message: 'Logistics option saved.' });
  } catch (error) {
    console.error('SCBS create logistics error:', error);
    res.status(500).json({ success: false, error: 'Unable to save logistics option.' });
  }
});
app.patch('/api/admin/logistics/:id', scbsLogisticsAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const active = req.body?.is_active;
    if (!Number.isInteger(id) || id < 1 || ![0,1,true,false].includes(active)) return res.status(400).json({ success: false, error: 'Invalid logistics ID or active setting.' });
    const result = db.prepare(`UPDATE scbs_logistics SET is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(active === true || active === 1 ? 1 : 0, id);
    if (!result.changes) return res.status(404).json({ success: false, error: 'Logistics option not found.' });
    res.json({ success: true, message: 'Logistics availability updated.' });
  } catch (error) {
    console.error('SCBS update logistics error:', error);
    res.status(500).json({ success: false, error: 'Unable to update logistics option.' });
  }
});
app.patch('/api/admin/logistics-bookings/:id', scbsLogisticsAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = scbsLogisticsText(req.body?.status, 30);
    if (!Number.isInteger(id) || id < 1 || !['pending','confirmed','in_transit','completed','cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Choose a valid booking status.' });
    const result = db.prepare(`UPDATE scbs_logistics_bookings SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(status, id);
    if (!result.changes) return res.status(404).json({ success: false, error: 'Booking not found.' });
    res.json({ success: true, message: 'Booking status updated.' });
  } catch (error) {
    console.error('SCBS update booking error:', error);
    res.status(500).json({ success: false, error: 'Unable to update booking status.' });
  }
});

app.listen(PORT, () => {
  console.log(`SCBS starter running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});















