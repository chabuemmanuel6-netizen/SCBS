// SCBS Rental Management Routes
// Uses the existing SCBS database and authentication middleware.

function registerRentalRoutes({
  app,
  db,
  requireAdmin,
  requireCustomer,
  requirePermission
}) {
  const VALID_CONDITIONS = [
    'excellent',
    'good',
    'fair',
    'repair'
  ];

  const RESERVED_STATUSES = [
    'requested',
    'approved',
    'active',
    'overdue'
  ];

  function isValidPrice(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function validQuantity(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function validCondition(value) {
    return VALID_CONDITIONS.includes(value);
  }

  function validDate(value, period) {
    if (typeof value !== 'string') return false;

    if (period === 'day') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
      }

      const date = new Date(`${value}T00:00:00Z`);

      return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
    }

    if (period === 'hour') {
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
      ) {
        return false;
      }

      const date = new Date(`${value.length === 16 ? value + ':00' : value}Z`);

      return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 19) ===
          `${value.length === 16 ? value + ':00' : value}.000Z`.slice(0, 19);
    }

    return false;
  }

  function normalizeDates(startDate, dueDate, period) {
    if (
      !validDate(startDate, period) ||
      !validDate(dueDate, period)
    ) {
      return null;
    }

    if (period === 'day') {
      return {
        start: `${startDate}T00:00:00`,
        due: `${dueDate}T23:59:59`
      };
    }

    return {
      start: startDate.length === 16
        ? `${startDate}:00`
        : startDate,
      due: dueDate.length === 16
        ? `${dueDate}:00`
        : dueDate
    };
  }

  function createBookingNumber() {
    return `SCBS-R-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
  }

  // PUBLIC: List active rental tools.
  app.get('/api/rentals', (req, res) => {
    try {
      const items = db.prepare(`
        SELECT
          id,
          item_code,
          name,
          description,
          hourly_rate_ngwee,
          daily_rate_ngwee,
          available_quantity,
          condition_status,
          image_url
        FROM rental_items
        WHERE is_active = 1
        ORDER BY name ASC
      `).all();

      res.json({
        success: true,
        count: items.length,
        rentals: items
      });
    } catch (error) {
      console.error('SCBS rental listing failed:', error.message);

      res.status(500).json({
        success: false,
        error: 'Unable to load rental tools.'
      });
    }
  });

  // OWNER: Add a rental tool.
  app.post('/api/admin/rentals', requireAdmin, requirePermission('products:write'), (req, res) => {
    try {
      const {
        item_code,
        name,
        description = '',
        hourly_rate_ngwee = null,
        daily_rate_ngwee,
        available_quantity,
        condition_status = 'good'
      } = req.body || {};

      if (
        typeof item_code !== 'string' ||
        !item_code.trim() ||
        typeof name !== 'string' ||
        !name.trim()
      ) {
        return res.status(400).json({
          success: false,
          error: 'Item code and tool name are required.'
        });
      }

      if (
        !isValidPrice(daily_rate_ngwee) ||
        (
          hourly_rate_ngwee !== null &&
          !isValidPrice(hourly_rate_ngwee)
        )
      ) {
        return res.status(400).json({
          success: false,
          error: 'Enter valid hourly and daily prices in ngwee.'
        });
      }

      if (
        !Number.isSafeInteger(available_quantity) ||
        available_quantity < 0
      ) {
        return res.status(400).json({
          success: false,
          error: 'Quantity must be zero or more.'
        });
      }

      if (!validCondition(condition_status)) {
        return res.status(400).json({
          success: false,
          error: 'Select a valid tool condition.'
        });
      }

      const result = db.prepare(`
        INSERT INTO rental_items (
          item_code,
          name,
          description,
          hourly_rate_ngwee,
          daily_rate_ngwee,
          available_quantity,
          condition_status,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        item_code.trim(),
        name.trim(),
        typeof description === 'string'
          ? description.trim()
          : '',
        hourly_rate_ngwee,
        daily_rate_ngwee,
        available_quantity,
        condition_status
      );

      res.status(201).json({
        success: true,
        message: 'Rental tool added successfully.',
        rental_id: Number(result.lastInsertRowid)
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({
          success: false,
          error: 'That rental item code already exists.'
        });
      }

      console.error('SCBS rental creation failed:', error.message);

      res.status(500).json({
        success: false,
        error: 'Unable to add the rental tool.'
      });
    }
  });

  // OWNER: Update an existing rental tool without replacing its picture.
  app.patch('/api/admin/rentals/:id', requireAdmin, requirePermission('products:write'), (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ success: false, error: 'Invalid rental tool ID.' });
      }

      const {
        item_code, name, description = '',
        hourly_rate_ngwee = null, daily_rate_ngwee,
        available_quantity, condition_status = 'good'
      } = req.body || {};

      if (typeof item_code !== 'string' || !item_code.trim() ||
          typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, error: 'Item code and tool name are required.' });
      }
      if (!isValidPrice(daily_rate_ngwee) ||
          (hourly_rate_ngwee !== null && !isValidPrice(hourly_rate_ngwee))) {
        return res.status(400).json({ success: false, error: 'Enter valid hourly and daily prices in ngwee.' });
      }
      if (!Number.isSafeInteger(available_quantity) || available_quantity < 0) {
        return res.status(400).json({ success: false, error: 'Quantity must be zero or more.' });
      }
      if (!validCondition(condition_status)) {
        return res.status(400).json({ success: false, error: 'Select a valid tool condition.' });
      }

      const existing = db.prepare(
        'SELECT id FROM rental_items WHERE id = ? AND is_active = 1'
      ).get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Active rental tool not found.' });
      }

      db.prepare(`
        UPDATE rental_items
        SET item_code = ?, name = ?, description = ?,
            hourly_rate_ngwee = ?, daily_rate_ngwee = ?,
            available_quantity = ?, condition_status = ?
        WHERE id = ? AND is_active = 1
      `).run(
        item_code.trim(),
        name.trim(),
        typeof description === 'string' ? description.trim() : '',
        hourly_rate_ngwee,
        daily_rate_ngwee,
        available_quantity,
        condition_status,
        id
      );

      return res.json({
        success: true,
        message: 'Rental tool updated successfully.',
        rental_id: id
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ success: false, error: 'That rental item code already exists.' });
      }
      console.error('SCBS rental update failed:', error.message);
      return res.status(500).json({ success: false, error: 'Unable to update the rental tool.' });
    }
  });

  // OWNER: Deactivate a tool while preserving booking history.
  app.delete('/api/admin/rentals/:id', requireAdmin, requirePermission('products:write'), (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ success: false, error: 'Invalid rental tool ID.' });
      }

      const result = db.prepare(`
        UPDATE rental_items
        SET is_active = 0
        WHERE id = ? AND is_active = 1
      `).run(id);

      if (result.changes === 0) {
        return res.status(404).json({ success: false, error: 'Active rental tool not found.' });
      }

      return res.json({
        success: true,
        message: 'Rental tool removed from public listings. Booking history was preserved.'
      });
    } catch (error) {
      console.error('SCBS rental deactivation failed:', error.message);
      return res.status(500).json({ success: false, error: 'Unable to deactivate the rental tool.' });
    }
  });
  // CUSTOMER: Submit a rental request.
  app.post(
    '/api/customer/rentals/bookings',
    requireCustomer,
    (req, res) => {
      try {
        const {
          rental_item_id,
          quantity,
          rental_period,
          start_date,
          due_date,
          notes = ''
        } = req.body || {};

        if (
          !Number.isSafeInteger(rental_item_id) ||
          rental_item_id <= 0
        ) {
          return res.status(400).json({
            success: false,
            error: 'Select a valid rental tool.'
          });
        }

        if (!validQuantity(quantity)) {
          return res.status(400).json({
            success: false,
            error: 'Quantity must be a positive whole number.'
          });
        }

        if (!['hour', 'day'].includes(rental_period)) {
          return res.status(400).json({
            success: false,
            error: 'Choose an hourly or daily rental.'
          });
        }

        if (
          typeof notes !== 'string' ||
          notes.length > 1000
        ) {
          return res.status(400).json({
            success: false,
            error: 'Notes must be no longer than 1000 characters.'
          });
        }

        const dates = normalizeDates(
          start_date,
          due_date,
          rental_period
        );

        if (
          !dates ||
          dates.due <= dates.start
        ) {
          return res.status(400).json({
            success: false,
            error: 'Enter valid start and end times, with the end after the start.'
          });
        }

        const createBooking = db.transaction(() => {
          const item = db.prepare(`
            SELECT
              id,
              name,
              hourly_rate_ngwee,
              daily_rate_ngwee,
              available_quantity,
              is_active
            FROM rental_items
            WHERE id = ?
          `).get(rental_item_id);

          if (!item || item.is_active !== 1) {
            throw new Error('RENTAL_NOT_AVAILABLE');
          }

          const rate = rental_period === 'hour'
            ? item.hourly_rate_ngwee
            : item.daily_rate_ngwee;

          if (!isValidPrice(rate)) {
            throw new Error('RENTAL_RATE_NOT_SET');
          }

          const overlapping = db.prepare(`
            SELECT COALESCE(SUM(quantity), 0) AS reserved
            FROM rental_bookings
            WHERE rental_item_id = ?
              AND status IN (
                'requested',
                'approved',
                'active',
                'overdue'
              )
              AND start_date < ?
              AND due_date > ?
          `).get(
            rental_item_id,
            dates.due,
            dates.start
          );

          const remaining =
            item.available_quantity - overlapping.reserved;

          if (quantity > remaining) {
            throw new Error('INSUFFICIENT_AVAILABILITY');
          }

          const start = new Date(`${dates.start}Z`);
          const due = new Date(`${dates.due}Z`);

          let units;

          if (rental_period === 'hour') {
            units = Math.ceil(
              (due.getTime() - start.getTime()) / 3600000
            );
          } else {
            units = Math.round(
              (Date.parse(`${due_date}T00:00:00Z`) -
                Date.parse(`${start_date}T00:00:00Z`)) /
                86400000
            ) + 1;
          }

          if (!Number.isSafeInteger(units) || units < 1) {
            throw new Error('INVALID_RENTAL_DURATION');
          }

          const total = rate * units * quantity;

          if (!Number.isSafeInteger(total)) {
            throw new Error('RENTAL_TOTAL_TOO_LARGE');
          }

          const bookingNumber = createBookingNumber();

          const result = db.prepare(`
            INSERT INTO rental_bookings (
              booking_number,
              customer_id,
              rental_item_id,
              quantity,
              start_date,
              due_date,
              daily_rate_ngwee,
              total_ngwee,
              status,
              notes,
              rental_period
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)
          `).run(
            bookingNumber,
            req.customer.id,
            rental_item_id,
            quantity,
            dates.start,
            dates.due,
            rate,
            total,
            notes.trim(),
            rental_period
          );

          return {
            id: Number(result.lastInsertRowid),
            booking_number: bookingNumber,
            rental_name: item.name,
            quantity,
            rental_period,
            start_date: dates.start,
            due_date: dates.due,
            rate_ngwee: rate,
            total_ngwee: total,
            status: 'requested'
          };
        });

        const booking = createBooking.immediate();

        res.status(201).json({
          success: true,
          message: 'Rental request submitted for owner approval.',
          booking
        });
      } catch (error) {
        if (error.message === 'RENTAL_NOT_AVAILABLE') {
          return res.status(404).json({
            success: false,
            error: 'This rental tool is not available.'
          });
        }

        if (error.message === 'RENTAL_RATE_NOT_SET') {
          return res.status(400).json({
            success: false,
            error: 'The selected rental rate has not been configured.'
          });
        }

        if (error.message === 'INSUFFICIENT_AVAILABILITY') {
          return res.status(409).json({
            success: false,
            error: 'There are not enough tools available for those dates.'
          });
        }

        if (error.message === 'INVALID_RENTAL_DURATION') {
          return res.status(400).json({
            success: false,
            error: 'The rental duration is invalid.'
          });
        }

        if (error.message === 'RENTAL_TOTAL_TOO_LARGE') {
          return res.status(400).json({
            success: false,
            error: 'The calculated rental total is too large.'
          });
        }

        console.error('SCBS booking creation failed:', error.message);

        res.status(500).json({
          success: false,
          error: 'Unable to submit the rental request.'
        });
      }
    }
  );

  // CUSTOMER: View only their own rental bookings.
  app.get(
    '/api/customer/rentals/bookings',
    requireCustomer,
    (req, res) => {
      try {
        const bookings = db.prepare(`
          SELECT
            b.id,
            b.booking_number,
            b.rental_item_id,
            i.name AS rental_name,
            b.quantity,
            b.start_date,
            b.due_date,
            b.rental_period,
            b.daily_rate_ngwee AS rate_ngwee,
            b.total_ngwee,
            b.status,
            b.notes,
            b.created_at
          FROM rental_bookings b
          JOIN rental_items i ON i.id = b.rental_item_id
          WHERE b.customer_id = ?
          ORDER BY b.created_at DESC
        `).all(req.customer.id);

        res.json({
          success: true,
          count: bookings.length,
          bookings
        });
      } catch (error) {
        console.error('SCBS customer bookings failed:', error.message);

        res.status(500).json({
          success: false,
          error: 'Unable to load your rental bookings.'
        });
      }
    }
  );

  // OWNER: View all rental bookings.
  app.get(
    '/api/admin/rentals/bookings',
    requireAdmin,
    requirePermission('orders:read'),
    (req, res) => {
      try {
        const bookings = db.prepare(`
          SELECT
            b.id,
            b.booking_number,
            b.customer_id,
            c.full_name AS customer_name,
            c.email AS customer_email,
            c.phone AS customer_phone,
            b.rental_item_id,
            i.name AS rental_name,
            b.quantity,
            b.start_date,
            b.due_date,
            b.rental_period,
            b.daily_rate_ngwee AS rate_ngwee,
            b.total_ngwee,
            b.status,
            b.notes,
            b.created_at
          FROM rental_bookings b
          JOIN rental_items i ON i.id = b.rental_item_id
          JOIN customers c ON c.id = b.customer_id
          ORDER BY
            CASE b.status
              WHEN 'requested' THEN 0
              WHEN 'approved' THEN 1
              WHEN 'active' THEN 2
              WHEN 'overdue' THEN 3
              ELSE 4
            END,
            b.created_at DESC
        `).all();

        res.json({
          success: true,
          count: bookings.length,
          bookings
        });
      } catch (error) {
        console.error('SCBS admin bookings failed:', error.message);

        res.status(500).json({
          success: false,
          error: 'Unable to load rental bookings.'
        });
      }
    }
  );

  // OWNER: Approve, cancel, activate, return or mark overdue.
  app.patch(
    '/api/admin/rentals/bookings/:id/status',
    requireAdmin,
    requirePermission('orders:write'),
    (req, res) => {
      try {
        const id = Number(req.params.id);
        const { status } = req.body || {};

        const allowedTransitions = {
          requested: ['approved', 'cancelled'],
          approved: ['active', 'cancelled'],
          active: ['returned', 'overdue'],
          overdue: ['returned']
        };

        if (!Number.isSafeInteger(id) || id <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Invalid booking ID.'
          });
        }

        if (
          ![
            'approved',
            'active',
            'returned',
            'cancelled',
            'overdue'
          ].includes(status)
        ) {
          return res.status(400).json({
            success: false,
            error: 'Invalid booking status.'
          });
        }

        const updateBooking = db.transaction(() => {
          const booking = db.prepare(`
            SELECT *
            FROM rental_bookings
            WHERE id = ?
          `).get(id);

          if (!booking) {
            throw new Error('BOOKING_NOT_FOUND');
          }

          const allowed = allowedTransitions[booking.status] || [];

          if (!allowed.includes(status)) {
            throw new Error('INVALID_STATUS_TRANSITION');
          }

          if (status === 'approved') {
            const item = db.prepare(`
              SELECT available_quantity, is_active
              FROM rental_items
              WHERE id = ?
            `).get(booking.rental_item_id);

            if (!item || item.is_active !== 1) {
              throw new Error('RENTAL_NOT_AVAILABLE');
            }

            const overlapping = db.prepare(`
              SELECT COALESCE(SUM(quantity), 0) AS reserved
              FROM rental_bookings
              WHERE rental_item_id = ?
                AND id != ?
                AND status IN (
                  'requested',
                  'approved',
                  'active',
                  'overdue'
                )
                AND start_date < ?
                AND due_date > ?
            `).get(
              booking.rental_item_id,
              booking.id,
              booking.due_date,
              booking.start_date
            );

            if (
              booking.quantity >
              item.available_quantity - overlapping.reserved
            ) {
              throw new Error('INSUFFICIENT_AVAILABILITY');
            }
          }

          db.prepare(`
            UPDATE rental_bookings
            SET status = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?
          `).run(status, id);

          return {
            id,
            booking_number: booking.booking_number,
            previous_status: booking.status,
            status
          };
        });

        const result = updateBooking.immediate();

        res.json({
          success: true,
          message: 'Rental booking status updated.',
          booking: result
        });
      } catch (error) {
        if (error.message === 'BOOKING_NOT_FOUND') {
          return res.status(404).json({
            success: false,
            error: 'Rental booking not found.'
          });
        }

        if (error.message === 'INVALID_STATUS_TRANSITION') {
          return res.status(409).json({
            success: false,
            error: 'That status change is not permitted.'
          });
        }

        if (error.message === 'RENTAL_NOT_AVAILABLE') {
          return res.status(409).json({
            success: false,
            error: 'The rental tool is no longer active.'
          });
        }

        if (error.message === 'INSUFFICIENT_AVAILABILITY') {
          return res.status(409).json({
            success: false,
            error: 'There is not enough availability to approve this booking.'
          });
        }

        console.error('SCBS booking status update failed:', error.message);

        res.status(500).json({
          success: false,
          error: 'Unable to update the booking status.'
        });
      }
    }
  );
}

export { registerRentalRoutes };
