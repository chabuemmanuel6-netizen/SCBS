export function registerAdminTeamRoutes({
  app,
  db,
  bcrypt,
  requireAdmin,
  requirePermission,
  requireOwner
}) {
  const safeAdminFields = `
    id, email, display_name, role, is_active,
    last_login_at, created_at, updated_at
  `;

  function writeAudit(adminId, action, targetId, details, ip) {
    db.prepare(`
      INSERT INTO audit_logs
        (admin_id, action, entity_type, entity_id, details_json, ip_address)
      VALUES (?, ?, 'admin', ?, ?, ?)
    `).run(
      adminId,
      action,
      targetId,
      JSON.stringify(details),
      String(ip || '').slice(0, 100)
    );
  }

  // List team members without returning password hashes.
  app.get(
    '/api/admin/team',
    requireAdmin,
    requirePermission('team:read'),
    (req, res, next) => {
      try {
        const team = db.prepare(`
          SELECT ${safeAdminFields}
          FROM admins
          ORDER BY created_at DESC, id DESC
        `).all();

        res.json({ success: true, team });
      } catch (error) {
        next(error);
      }
    }
  );

  // Create a manager or staff account. Owner creation is deliberately excluded.
  app.post(
    '/api/admin/team',
    requireAdmin,
    requireOwner,
    async (req, res, next) => {
      try {
        const email = typeof req.body?.email === 'string'
          ? req.body.email.trim().toLowerCase()
          : '';

        const displayName = typeof req.body?.display_name === 'string'
          ? req.body.display_name.trim()
          : '';

        const password = typeof req.body?.password === 'string'
          ? req.body.password
          : '';

        const role = req.body?.role;

        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 254
        ) {
          return res.status(400).json({
            success: false,
            error: 'Enter a valid email address.'
          });
        }

        if (!displayName || displayName.length > 100) {
          return res.status(400).json({
            success: false,
            error: 'Display name must contain 1–100 characters.'
          });
        }

        if (password.length < 12 || password.length > 1024) {
          return res.status(400).json({
            success: false,
            error: 'Password must contain at least 12 characters.'
          });
        }

        if (!['manager', 'staff'].includes(role)) {
          return res.status(400).json({
            success: false,
            error: 'New accounts can only be managers or staff.'
          });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const createAccount = db.transaction(() => {
          const result = db.prepare(`
            INSERT INTO admins
              (email, password_hash, display_name, role, is_active)
            VALUES (?, ?, ?, ?, 1)
          `).run(email, passwordHash, displayName, role);

          const id = Number(result.lastInsertRowid);

          writeAudit(
            req.admin.id,
            'admin_created',
            id,
            { email, display_name: displayName, role },
            req.ip
          );

          return db.prepare(`
            SELECT ${safeAdminFields}
            FROM admins WHERE id = ?
          `).get(id);
        });

        const admin = createAccount();

        res.status(201).json({
          success: true,
          message: 'Administrator account created.',
          admin
        });
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({
            success: false,
            error: 'An account with that email already exists.'
          });
        }
        next(error);
      }
    }
  );

  // Only manager/staff accounts can be changed through this endpoint.
  app.patch(
    '/api/admin/team/:id/role',
    requireAdmin,
    requireOwner,
    (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const role = req.body?.role;

        if (!Number.isSafeInteger(id) || id < 1) {
          return res.status(400).json({
            success: false,
            error: 'Invalid administrator ID.'
          });
        }

        if (!['manager', 'staff'].includes(role)) {
          return res.status(400).json({
            success: false,
            error: 'Role must be manager or staff.'
          });
        }

        const changeRole = db.transaction(() => {
          const target = db.prepare(`
            SELECT id, email, display_name, role, is_active
            FROM admins WHERE id = ?
          `).get(id);

          if (!target) return { notFound: true };

          if (target.role === 'owner') {
            return { ownerProtected: true };
          }

          db.prepare(`
            UPDATE admins
            SET role = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?
          `).run(role, id);

          writeAudit(
            req.admin.id,
            'admin_role_changed',
            id,
            { previous_role: target.role, new_role: role },
            req.ip
          );

          return {
            admin: db.prepare(`
              SELECT ${safeAdminFields} FROM admins WHERE id = ?
            `).get(id)
          };
        });

        const result = changeRole();

        if (result.notFound) {
          return res.status(404).json({
            success: false,
            error: 'Administrator not found.'
          });
        }

        if (result.ownerProtected) {
          return res.status(409).json({
            success: false,
            error: 'Owner roles cannot be changed through this endpoint.'
          });
        }

        res.json({ success: true, admin: result.admin });
      } catch (error) {
        next(error);
      }
    }
  );

  // Activate/deactivate a non-owner account.
  app.patch(
    '/api/admin/team/:id/status',
    requireAdmin,
    requireOwner,
    (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const active = req.body?.is_active;

        if (!Number.isSafeInteger(id) || id < 1) {
          return res.status(400).json({
            success: false,
            error: 'Invalid administrator ID.'
          });
        }

        if (typeof active !== 'boolean') {
          return res.status(400).json({
            success: false,
            error: 'is_active must be true or false.'
          });
        }

        const changeStatus = db.transaction(() => {
          const target = db.prepare(`
            SELECT id, email, role, is_active
            FROM admins WHERE id = ?
          `).get(id);

          if (!target) return { notFound: true };

          if (target.role === 'owner') {
            return {
              ownerProtected: true,
              message: 'Owner accounts cannot be changed through this endpoint.'
            };
          }

          if (target.is_active === Number(active)) {
            return {
              unchanged: true,
              admin: db.prepare(`
                SELECT ${safeAdminFields} FROM admins WHERE id = ?
              `).get(id)
            };
          }

          db.prepare(`
            UPDATE admins
            SET is_active = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?
          `).run(Number(active), id);

          writeAudit(
            req.admin.id,
            active ? 'admin_activated' : 'admin_deactivated',
            id,
            { email: target.email, is_active: active },
            req.ip
          );

          return {
            admin: db.prepare(`
              SELECT ${safeAdminFields} FROM admins WHERE id = ?
            `).get(id)
          };
        });

        const result = changeStatus();

        if (result.notFound) {
          return res.status(404).json({
            success: false,
            error: 'Administrator not found.'
          });
        }

        if (result.ownerProtected) {
          return res.status(409).json({
            success: false,
            error: result.message
          });
        }

        res.json({
          success: true,
          message: result.unchanged
            ? 'Account status was already set.'
            : 'Administrator status updated.',
          admin: result.admin
        });
      } catch (error) {
        next(error);
      }
    }
  );
}
