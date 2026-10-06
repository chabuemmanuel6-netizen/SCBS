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
const dbDir = process.env.NODE_ENV === 'production'
  ? '/data'
  : __dirname;

const dbPath = path.join(dbDir, 'scbs.db');
const db = new Database(dbPath);db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
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
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 price TEXT NOT NULL DEFAULT '',
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
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

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
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({ windowMs: 15*60*1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const publicLimiter = rateLimit({ windowMs: 60*1000, limit: 120, standardHeaders: true, legacyHeaders: false });

const loginSchema = z.object({ email:z.string().email().max(254), password:z.string().min(1).max(200) });
const messageSchema = z.object({ customer_name:z.string().trim().min(1).max(100), customer_contact:z.string().trim().min(3).max(100), message:z.string().trim().min(1).max(2000) });
const productSchema = z.object({ name:z.string().trim().min(1).max(120), category:z.string().trim().min(1).max(100), description:z.string().trim().max(1000).default(''), price:z.string().trim().max(100).default(''), stock:z.coerce.number().int().min(0).default(0), image_url:z.string().trim().max(1000).default(''), available:z.boolean().default(true) });
const adSchema = z.object({ title:z.string().trim().min(1).max(160), body:z.string().trim().max(2000).default(''), image_url:z.string().trim().max(1000).default(''), active:z.boolean().default(true) });

function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex'); }
function createSession(adminId) {
 const id = crypto.randomBytes(32).toString('hex');
 const expires = Date.now() + 8*60*60*1000;
 db.prepare('INSERT INTO sessions(id,admin_id,expires_at) VALUES(?,?,?)').run(id, adminId, expires);
 return { id, expires };
}
function getAdmin(req) {
 const raw = req.cookies.scbs_session;
 if (!raw) return null;
 const [id, mac] = raw.split('.');
 if (!id || !mac || sign(id) !== mac) return null;
 const row = db.prepare('SELECT a.id,a.email,s.expires_at FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.id=?').get(id);
 if (!row || row.expires_at < Date.now()) { if(row) db.prepare('DELETE FROM sessions WHERE id=?').run(id); return null; }
 return row;
}
function requireAdmin(req,res,next) { const admin=getAdmin(req); if(!admin) return res.status(401).json({error:'Authentication required'}); req.admin=admin; next(); }
function cleanSessions() { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }
setInterval(cleanSessions, 30*60*1000).unref();

app.use('/api/public', publicLimiter);
app.post('/api/auth/login', authLimiter, (req,res)=>{
 const parsed=loginSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({error:'Invalid login details'});
 const email=parsed.data.email.toLowerCase(); const admin=db.prepare('SELECT * FROM admins WHERE email=?').get(email);
 if(!admin || !bcrypt.compareSync(parsed.data.password, admin.password_hash)) return res.status(401).json({error:'Invalid email or password'});
 const session=createSession(admin.id); res.cookie('scbs_session', `${session.id}.${sign(session.id)}`, {httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:8*60*60*1000,path:'/'});
 res.json({ok:true,email:admin.email});
});
app.post('/api/auth/logout', requireAdmin, (req,res)=>{ const raw=req.cookies.scbs_session; const id=raw?.split('.')[0]; if(id) db.prepare('DELETE FROM sessions WHERE id=?').run(id); res.clearCookie('scbs_session',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/'}); res.json({ok:true}); });
app.get('/api/auth/me',(req,res)=>{ const a=getAdmin(req); res.json({authenticated:!!a, email:a?.email||null}); });

app.get('/api/public/data',(req,res)=>{
 res.json({
 products:db.prepare('SELECT id,name,category,description,price,stock,image_url,available FROM products WHERE available=1 ORDER BY id DESC').all(),
  services:db.prepare('SELECT id,name,description FROM services WHERE active=1 ORDER BY id DESC').all(),
  advertisements:db.prepare('SELECT id,title,body,image_url FROM advertisements WHERE active=1 ORDER BY id DESC').all()
 });
});
app.post('/api/public/messages',(req,res)=>{ const p=messageSchema.safeParse(req.body); if(!p.success) return res.status(400).json({error:'Please provide valid contact details and message'}); db.prepare('INSERT INTO messages(customer_name,customer_contact,message) VALUES(?,?,?)').run(p.data.customer_name,p.data.customer_contact,p.data.message); res.status(201).json({ok:true}); });

app.get('/api/admin/dashboard',requireAdmin,(req,res)=>res.json({
 products:db.prepare('SELECT * FROM products ORDER BY id DESC').all(),
 services:db.prepare('SELECT * FROM services ORDER BY id DESC').all(),
 advertisements:db.prepare('SELECT * FROM advertisements ORDER BY id DESC').all(),
 messages:db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 100').all()
}));
app.post('/api/admin/products',requireAdmin,(req,res)=>{const p=productSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid product'});const x=p.data;const r=db.prepare('INSERT INTO products(name,category,description,price,stock,image_url,available) VALUES(?,?,?,?,?,?,?)').run(x.name,x.category,x.description,x.price,x.stock,x.image_url,x.available?1:0);res.status(201).json({id:r.lastInsertRowid});});app.delete('/api/admin/products/:id',requireAdmin,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(Number(req.params.id));res.status(204).end();});
app.post('/api/admin/services',requireAdmin,(req,res)=>{const p=serviceSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid service'});const x=p.data;const r=db.prepare('INSERT INTO services(name,description,active) VALUES(?,?,?)').run(x.name,x.description,x.active?1:0);res.status(201).json({id:r.lastInsertRowid});});
app.delete('/api/admin/services/:id',requireAdmin,(req,res)=>{db.prepare('DELETE FROM services WHERE id=?').run(Number(req.params.id));res.status(204).end();});
app.post('/api/admin/advertisements',requireAdmin,(req,res)=>{const p=adSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid advertisement'});const x=p.data;const r=db.prepare('INSERT INTO advertisements(title,body,image_url,active) VALUES(?,?,?,?)').run(x.title,x.body,x.image_url,x.active?1:0);res.status(201).json({id:r.lastInsertRowid});});
app.delete('/api/admin/advertisements/:id',requireAdmin,(req,res)=>{db.prepare('DELETE FROM advertisements WHERE id=?').run(Number(req.params.id));res.status(204).end();});
app.get('/api/admin/messages',requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 200').all()));

app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`SCBS running at http://localhost:${PORT}`));
