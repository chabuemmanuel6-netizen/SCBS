import { canTransitionOrder } from './order-workflow.js';

export function initializeOrderCancellationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_inventory_restorations (
      order_id INTEGER PRIMARY KEY
        REFERENCES orders(id) ON DELETE RESTRICT,
      restored_by INTEGER
        REFERENCES admins(id) ON DELETE SET NULL,
      restored_at TEXT NOT NULL
        DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      details_json TEXT NOT NULL
    );
  `);
}

export function cancelOrder(
  db,
  {
    orderId,
    adminId,
    ipAddress = '',
    source = 'admin'
  }
) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return {
      success: false,
      statusCode: 400,
      error: 'Invalid order ID.'
    };
  }

  const cancelTransaction = db.transaction(() => {
    const order = db.prepare(`
      SELECT id, order_number, status
      FROM orders
      WHERE id = ?
    `).get(orderId);

    if (!order) {
      return {
        success: false,
        statusCode: 404,
        error: 'Order not found.'
      };
    }

    if (!canTransitionOrder(order.status, 'cancelled')) {
      return {
        success: false,
        statusCode: 409,
        error: `Order cannot be cancelled from '${order.status}'.`
      };
    }

    const alreadyRestored = db.prepare(`
      SELECT order_id
      FROM order_inventory_restorations
      WHERE order_id = ?
    `).get(orderId);

    if (alreadyRestored) {
      return {
        success: false,
        statusCode: 409,
        error: 'Inventory for this order has already been restored.'
      };
    }

    const items = db.prepare(`
      SELECT id, product_id, book_id, item_name, quantity
      FROM order_items
      WHERE order_id = ?
      ORDER BY id
    `).all(orderId);

    if (items.length === 0) {
      return {
        success: false,
        statusCode: 409,
        error: 'This order has no items to restore. Please review it manually.'
      };
    }

    // Validate every item before changing any inventory.
    const inventoryUpdates = [];

    for (const item of items) {
      if (
        (item.product_id === null && item.book_id === null) ||
        (item.product_id !== null && item.book_id !== null) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0
      ) {
        return {
          success: false,
          statusCode: 409,
          error: `Order item ${item.id} has an invalid or deleted inventory reference. Review it manually before cancelling.`
        };
      }

      const isProduct = item.product_id !== null;
      const inventoryId = isProduct ? item.product_id : item.book_id;
      const table = isProduct ? 'products' : 'books';

      const inventory = db.prepare(`
        SELECT id, stock_quantity
        FROM ${table}
        WHERE id = ?
      `).get(inventoryId);

      if (!inventory) {
        return {
          success: false,
          statusCode: 409,
          error: `Inventory record for "${item.item_name}" is missing. Review it manually before cancelling.`
        };
      }

      if (
        !Number.isSafeInteger(inventory.stock_quantity) ||
        inventory.stock_quantity < 0 ||
        !Number.isSafeInteger(inventory.stock_quantity + item.quantity)
      ) {
        return {
          success: false,
          statusCode: 409,
          error: `Restoring stock for "${item.item_name}" would exceed the supported quantity range.`
        };
      }

      inventoryUpdates.push({
        table,
        inventoryId,
        quantity: item.quantity,
        itemName: item.item_name
      });
    }

    const details = inventoryUpdates.map(item => ({
      table: item.table,
      inventory_id: item.inventoryId,
      quantity: item.quantity,
      item_name: item.itemName
    }));

    // The unique order_id prevents a second restoration.
    db.prepare(`
      INSERT INTO order_inventory_restorations
        (order_id, restored_by, details_json)
      VALUES (?, ?, ?)
    `).run(
      orderId,
      Number.isSafeInteger(adminId) ? adminId : null,
      JSON.stringify(details)
    );

    for (const item of inventoryUpdates) {
      const update = db.prepare(`
        UPDATE ${item.table}
        SET stock_quantity = stock_quantity + ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(item.quantity, item.inventoryId);

      if (update.changes !== 1) {
        throw new Error(
          `Stock restoration failed for "${item.itemName}".`
        );
      }
    }

    const statusUpdate = db.prepare(`
      UPDATE orders
      SET status = 'cancelled',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status = ?
    `).run(orderId, order.status);

    if (statusUpdate.changes !== 1) {
      throw new Error(
        'Order status changed unexpectedly. The cancellation was rolled back.'
      );
    }

    db.prepare(`
      INSERT INTO audit_logs (
        admin_id,
        action,
        entity_type,
        entity_id,
        details_json,
        ip_address
      )
      VALUES (?, 'order_cancelled', 'order', ?, ?, ?)
    `).run(
      Number.isSafeInteger(adminId) ? adminId : null,
      orderId,
      JSON.stringify({
        order_number: order.order_number,
        previous_status: order.status,
        new_status: 'cancelled',
        source,
        inventory_restored: details
      }),
      String(ipAddress).slice(0, 100)
    );

    return {
      success: true,
      order: {
        id: order.id,
        order_number: order.order_number,
        previous_status: order.status,
        status: 'cancelled'
      },
      inventory_restored: details
    };
  });

  return cancelTransaction();
}
