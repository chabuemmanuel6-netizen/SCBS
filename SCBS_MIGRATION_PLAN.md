# SCBS legacy-to-upgrade database migration plan

Status: design review only. No database has been changed by this document.

## Safety boundary
- Keep `main` and Railway production unchanged.
- Do not run this plan directly against Railway's `/data/scbs.db`.
- Test migration against a consistent staging copy of the actual production database, including WAL state (use SQLite backup API or a verified volume backup).
- The backup audited on 2026-10-28 passes `PRAGMA quick_check`, but its schema is already closer to the upgraded platform. It is not proof that the legacy production schema can be upgraded.

## Verified legacy schema (current main server.js)
- `customers`: `id, name, email, phone, password_hash, created_at, updated_at`
- `products`: `id, name, description, category, price (TEXT), stock, image_url, available, created_at, updated_at`
- `services`: `id, name, description, active, created_at, updated_at`
- `tool_rentals`: `id, name, category, description, hourly_rate (TEXT), image_url, available, active, created_at, updated_at`
- `messages`: `id, customer_name, customer_contact, message, status, created_at, updated_at`
- `orders`: `id, customer_id, order_number, items_json, total_amount, status, customer_note, created_at, updated_at`
- Legacy `admins` and `sessions` are created by the current server. Existing IDs and password hashes must remain unchanged.

## Upgrade target fields evidenced by the review-branch code
- `customers`: `full_name` plus existing identity/authentication fields and account-control fields.
- `products`: `sku, category_id, product_type, price_ngwee, stock_quantity, is_active` plus name/description/image and timestamps.
- `books`: `title, price_ngwee, stock_quantity, publication_status` and fields required by book-management routes.
- `rental_items`: `item_code, hourly_rate_ngwee, daily_rate_ngwee, available_quantity, condition_status, is_active`.
- `rental_bookings`: uses `start_date` and `due_date` (not `start_at` / `due_at`), and stores quantity, rate, total, status, rental period and customer/item IDs.
- `orders`: uses `currency, subtotal_ngwee, discount_ngwee, total_ngwee, customer_notes` alongside status/order identity and cancellation fields.
- `order_items`: line-level product/book references, item name, quantity, unit price and line total.
- `messages`: uses `reference_code, customer_id, name, email, phone, subject, message` and reply/read timestamps.
- New SCBS posts, issue reports, videos, customer posts, logistics and logistics bookings are introduced by the upgrade server.

## Migration rules
1. Add target columns/tables without dropping legacy columns. This keeps rollback options and protects existing features.
2. Preserve primary keys, customer IDs, admin IDs, order numbers, and timestamps wherever possible.
3. Convert product/book money only after a tested parser establishes how legacy price text is formatted. Store ZMW in integer ngwee; never silently guess ambiguous values.
4. Backfill `full_name` from legacy `name`; retain `name` until all code paths are proven compatible.
5. Preserve `orders.items_json` and `total_amount`. Do not generate `order_items` blindly: first inspect real JSON shapes and map each line to product/book IDs, quantities, and historical unit prices. Orders that cannot be mapped must be reported for manual reconciliation, not discarded.
6. Convert order status values through an explicit, reviewed mapping. Keep the original value available until transition and cancellation behavior is tested.
7. Map `tool_rentals` into `rental_items` only with a documented rule for rate conversion and availability. Legacy tool rentals do not necessarily have daily rates or quantities, so do not fabricate those values.
8. Preserve message content and contact strings. Populate customer identity, email/phone, and subject only where the source supports it; do not invent personal data.
9. Run migrations inside a transaction where SQLite supports it; maintain a schema version; make reruns idempotent.
10. Validate row counts, foreign keys, integrity, inventory totals, order totals, and representative customer/order/rental records before any production release.

## Release gate
Do not merge PR #1 until a migration implementation is tested against a copy of the actual legacy production database and the upgraded application passes startup, login, products, services, books, customer portal/messages, order placement/cancellation, and rental booking tests. Railway production remains unchanged until the release gate passes.

## Additional startup blocker found during code review

The upgrade server previously created `messages_customer_date_idx` unconditionally after adding reply columns. The legacy production `messages` table has neither `customer_id` nor the new customer-linked message shape, so SQLite would reject the index creation and stop the application at startup. The review branch now creates that index only when both referenced columns exist (commit `587bc5110c0c7b1055f8fe6af53c51477c1169d4`). This prevents that specific startup crash; it does **not** make all new message routes compatible with the legacy schema. The migration and end-to-end checks below remain required.
