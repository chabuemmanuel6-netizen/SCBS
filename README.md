# Sergio Chabu Business System (SCBS)

Secure full-stack starting point for the SCBS business app.

## Run locally

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set `SESSION_SECRET`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD`.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

The SQLite database is created automatically as `scbs.db` on first run.

## Features

- Public products, services and advertisements
- Customer message submission
- Real admin login
- Server-side sessions
- Admin CRUD for products/services/advertisements
- Admin-only customer message access
- Password hashing
- Rate limiting and security headers
- Input validation

## Important

This is a secure development foundation, not a claim of absolute security. Before handling real customer data or publishing the production app, complete the security checklist in `SECURITY.md`, perform dependency auditing and penetration testing, and use a production HTTPS deployment.
