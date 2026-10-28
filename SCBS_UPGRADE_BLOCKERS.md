# SCBS upgrade compatibility blockers

Status: static review only. No production database or deployment has been changed.

## Highest-priority finding

The review-branch `server.js` does not initialize the complete upgraded business schema. Its startup-time `CREATE TABLE IF NOT EXISTS` statements cover `scbs_posts`, `scbs_issue_reports`, `scbs_videos`, `scbs_customer_posts`, `scbs_logistics`, and `scbs_logistics_bookings`, plus a cancellation-restoration table from `order-cancellation.js`. Other routes immediately query upgraded tables and columns that are not created or fully migrated by those startup statements.

The current production schema on `main` is legacy. Therefore, guarding the one messages index prevents that particular crash, but it does not make the upgraded server production-compatible.

## Confirmed compatibility gaps

| Area | Legacy production shape | Upgrade code expects | Required before release |
|---|---|---|---|
| Administrator login | `admins(id,email,password_hash,created_at,updated_at)` | `role`, `is_active`, `display_name`, `last_login_at` and team/permission fields | Additive, idempotent migration and role/default review; preserve existing password hashes and IDs. |
| Customer identity | `customers.name` | `full_name`, `customer_code`, `status`, `profile_picture_url`, `country`, and account-control fields | Add missing columns safely; backfill `full_name` from `name`; retain legacy field until compatibility tests pass. |
| Products | `price` text, `stock`, `available`, `category` text | `sku`, `category_id`, `product_type`, `price_ngwee`, `stock_quantity`, `is_active` | Create categories and target columns/tables; price conversion must use a verified parser, never guess. |
| Books | No legacy `books` table | Book routes and checkout query `books` with `price_ngwee`, `stock_quantity`, `publication_status` | Create the complete table and indexes from the route contract before those routes can run. |
| Services | Legacy `active` flag and basic details | Also expects `image_url` | Additive column is present; verify route and UI behavior against existing records. |
| Tool rentals | `tool_rentals`, `hourly_rate` text, `available`, `active` | `rental_items`, `rental_bookings`, ngwee rates, quantities, condition and date fields | Define explicit mapping; do not invent daily rates or quantities. Create target tables and reconcile records before enabling rental routes. |
| Customer messages | `customer_name`, `customer_contact`, `message`, `status` | `reference_code`, `customer_id`, `name`, `email`, `phone`, `subject`, reply/read fields | Preserve original content/contact; only populate fields supported by source data. Add required schema before enabling upgraded message queries. |
| Orders | `items_json`, `total_amount` REAL, `customer_note`, legacy status casing | `currency`, `subtotal_ngwee`, `discount_ngwee`, `total_ngwee`, `customer_notes`, cancellation metadata and line items | Preserve source fields; inspect real JSON and statuses; map only verified line items. Never fabricate order-item history. |
| Order delivery/payment | No verified legacy tables for `customer_addresses`, `order_delivery_addresses`, `payments`, `order_change_requests` | Checkout and customer portal routes query these tables | Add full, reviewed DDL and indexes; test foreign keys and checkout before release. |
| Audit and cancellation | Legacy schema does not establish all required fields/tables | Cancellation path inserts into `audit_logs` and `order_inventory_restorations`, and restores `products.stock_quantity` / `books.stock_quantity` | Create all dependencies and prove transaction rollback/idempotency on staging. |

## Release sequence

1. Obtain a consistent staging copy of the actual production database, including committed WAL state. The existing 2026-10-28 backup is not proof of legacy compatibility because it appears closer to the upgraded schema.
2. Implement a versioned, additive migration with complete DDL for every table/column/index used by the upgraded routes. It must be idempotent and transactional where possible.
3. Build a mapping report before transforming values: legacy price formats, order JSON shapes/statuses, and rental rows must be inspected rather than assumed.
4. Run the read-only schema audit and a separate data-integrity report on staging. Compare row counts and key IDs before/after; run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
5. Start the upgraded app against the migrated staging copy and test admin login/team permissions, customer login/profile/addresses, products/services/books, messages/replies, checkout/order cancellation, rentals/bookings, advertisements, and new SCBS posts/logistics.
6. Do not merge PR #1 or deploy to Railway until a verified rollback/backup path exists and every release gate passes. Do not point staging at Railway's `/data/scbs.db`.

## What has and has not been done

- Done: static source review, a read-only schema audit script, migration-plan documentation, and a guard against one legacy messages-index startup failure.
- Not done: complete legacy-to-upgrade migration, staging end-to-end tests, production backup verification, PR merge, or deployment.
