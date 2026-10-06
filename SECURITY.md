# SCBS Security Baseline

This build is designed so the browser never stores the admin password or database credentials.

- Passwords are stored as bcrypt hashes (not plaintext).
- Admin sessions use random server-side session IDs stored in SQLite and an HTTP-only, SameSite cookie.
- Session cookies are marked Secure in production.
- Admin endpoints require server-side authentication; hiding the admin UI is not the security boundary.
- Login is rate limited.
- Input is validated with Zod and request bodies are size limited.
- Helmet supplies baseline security headers.
- SQLite foreign keys and WAL mode are enabled.
- Customer-facing endpoints cannot directly query or modify admin tables.

Before production/Play Store release:
1. Set a strong random SESSION_SECRET (32+ characters; preferably 64+ random bytes).
2. Set a unique admin email and strong password through environment variables; never commit .env.
3. Use HTTPS/TLS.
4. Put the API behind a trusted reverse proxy and firewall.
5. Back up the database securely and encrypt backups.
6. For scale, move from SQLite to a managed PostgreSQL database with least-privilege credentials.
7. Add email/phone verification, password reset, MFA, audit logs, CSRF protection for cookie-authenticated state changes, and object-storage uploads before production.
8. Do not place secrets, service keys, or database connection strings in the Android app.
9. Keep dependencies updated and run vulnerability audits before release.
