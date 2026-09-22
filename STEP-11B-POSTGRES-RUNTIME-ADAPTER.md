# STEP 11B: PostgreSQL Runtime Adapter

## Status

**STEP 11B COMPLETE — POSTGRES ADAPTER READY, EXISTING ROUTES UNCHANGED**

This step adds a reusable asynchronous PostgreSQL data-access foundation. It does not integrate the adapter into `server.js`, does not convert any SQLite call site, and does not change API routes, request/response formats, authentication, frontend files, SQLite files, uploads, or PostgreSQL application data.

## Files changed

None of the existing runtime files were changed.

## Files created

- `database/postgres-adapter.js`
- `database/test-postgres-adapter.js`
- `STEP-11B-POSTGRES-RUNTIME-ADAPTER.md`

`package.json` was not changed because `pg` is already present.

## Adapter design

`database/postgres-adapter.js` imports the existing `database/postgres.js` pool and exposes an asynchronous interface:

- `query(sql, parameters)` returns the native node-postgres result.
- `get(sql, parameters)` returns the first row or `undefined`.
- `all(sql, parameters)` returns `result.rows`.
- `run(sql, parameters)` returns `{ changes, rows, lastInsertRowid }` as a compatibility-shaped result. `lastInsertRowid` is populated only when the SQL includes `RETURNING id`; PostgreSQL does not generate it implicitly for an ordinary insert.
- `exec(sql)` runs parameterless SQL intended for controlled DDL/session statements. Parameterized operations must use `query`, `get`, `all`, or `run`.
- `beginTransaction()` checks out a pool client and begins `BEGIN`. It returns a transaction database object plus `commit()` and `rollback()`.
- `transaction(callback)` begins a transaction, awaits the callback, commits on success, rolls back on any error, and always releases the client.
- `pool` is exported for controlled shutdown/testing.

All methods are asynchronous. The adapter deliberately does not pretend PostgreSQL is synchronous.

## Parameter conversion strategy

`convertQuestionPlaceholders(sql, parameters)` is a narrowly scoped transition aid for existing SQLite-style parameter lists:

- Converts `?` to `$1`, `$2`, and so on only outside single-quoted strings, double-quoted identifiers, line comments, block comments, and dollar-quoted strings.
- Rejects mixed SQLite `?` and PostgreSQL `$n` placeholders.
- Rejects a parameter count that does not exactly match the placeholder count.
- Rejects unterminated strings/comments.
- Does not rewrite identifiers, SQL functions, operators, table names, or SQLite-specific syntax.
- Does not perform a blind global replacement.

The converter is suitable only for a reviewed query at a time. It does not make SQLite SQL PostgreSQL-compatible by itself. Every query still requires a semantic review for table/column names, booleans, dates, JSON, conflict behavior, nullability, and PostgreSQL functions.

For new PostgreSQL queries, prefer native `$1`, `$2` placeholders. The `?` bridge exists only to reduce mechanical risk during incremental route conversion.

## PostgreSQL result mapping

The adapter preserves native node-postgres values:

- Rows are available through `result.rows`.
- A single row is `result.rows[0]`.
- Affected rows are `result.rowCount`, exposed as `changes` by `run`.
- Generated IDs must be requested explicitly with `INSERT ... RETURNING id`; the adapter maps the returned `id` to `lastInsertRowid` only as a transitional compatibility field.
- PostgreSQL booleans remain booleans.
- PostgreSQL `DATE`/timestamp and numeric values retain node-postgres representations. Route code must handle date-only values without timezone shifts and must not assume every numeric value is a JavaScript number.
- PostgreSQL JSON/JSONB values are returned by the driver as parsed values when the driver type parser supports it; callers must preserve the expected API representation.
- `NULL` remains `null`.

The adapter does not silently coerce values, round numbers, reformat dates, or alter authentication fields.

## SQLite API to PostgreSQL API mapping

| Existing SQLite pattern | Adapter/PostgreSQL replacement | Required route change |
|---|---|---|
| `db.prepare(sql).get(...params)` | `await postgres.get(sql, params)` | Make the containing function/route `async`; use the returned row or `undefined`. |
| `db.prepare(sql).all(...params)` | `await postgres.all(sql, params)` | Await the array before building the response. |
| `db.prepare(sql).run(...params)` | `await postgres.run(sql, params)` | Use `changes` from `rowCount`; add `RETURNING id` when an ID is needed. |
| `db.exec(sql)` | `await postgres.exec(sql)` or reviewed `query` | Remove SQLite DDL/PRAGMA assumptions; use deployment-managed PostgreSQL schema. |
| `result.lastInsertRowid` | `result.rows[0].id` from `RETURNING id` or adapter `lastInsertRowid` | Add explicit `RETURNING id` and preserve the existing response field semantics. |
| `result.changes` | `result.rowCount` or adapter `changes` | Preserve 404/no-op behavior explicitly. |
| `?` parameters | `$1`, `$2`, or the checked adapter bridge | Review every query; do not convert SQLite SQL blindly. |
| `db.transaction(...)` or implicit synchronous grouping | `await postgres.transaction(async transaction => { ... })` | Group dependent writes and roll back on any failure. |
| `db.pragma(...)` | Pool/client configuration and PostgreSQL constraints | Remove from runtime PostgreSQL path; never send SQLite pragmas to PostgreSQL. |

## Async conversion requirements

The adapter is not integrated into routes yet because the current server assumes synchronous control flow at 233 SQLite call sites. Each conversion must:

1. Mark the handler or helper `async`.
2. Add `await` to every database operation.
3. Move response creation after the awaited result.
4. Add one consistent error path so a rejected query cannot produce a second response.
5. Replace `.get/.all/.run` result assumptions with `row`, `rows`, and `rowCount` semantics.
6. Replace `lastInsertRowid` with explicit `RETURNING id`.
7. Replace SQLite-only SQL (`INSERT OR IGNORE`, `datetime('now')`, `PRAGMA`, `sqlite_master`, SQLite schema mutation) with reviewed PostgreSQL equivalents.
8. Preserve nulls, booleans, dates, numeric precision, JSON/JSONB, and response serialization.
9. Use a checked-out transaction client for dependent writes rather than mixing pool calls and transaction-client calls.
10. Ensure every checked-out client is released on both success and failure.

Startup initialization needs a separate conversion design. `server.js` currently loads SQLite schema, mutates columns, normalizes legacy data, creates demo accounts, and seeds records before serving requests. Those writes must not be pointed at migrated PostgreSQL data unchanged.

## Transaction strategy

Use `postgres.transaction(async transaction => { ... })` for workflows where statements must succeed together:

- student/faculty registration: user plus profile row;
- password-reset state changes where multiple records are affected;
- fee payment plus fee-balance update plus audit log;
- document/file metadata plus audit log, with explicit file cleanup on rollback;
- result import/review/publication batches;
- leave review plus audit log;
- notification creation/recipient links/audit log;
- admin settings or content writes with audit records.

Use ordinary pool queries for independent reads. Do not hold a transaction open across external network calls or file uploads longer than necessary. A future route conversion must never use `pool.query` for one statement and a separate pool connection for another statement that is supposed to be atomic.

## ID generation strategy

The migrated PostgreSQL tables use identity columns and preserved SQLite IDs. New runtime inserts must use explicit `RETURNING id` and pass that ID to dependent inserts/audit records. After explicit migration IDs, sequences were repaired and validated, but each converted insert must still avoid assuming SQLite rowid behavior.

The adapter’s `lastInsertRowid` compatibility field is only a bridge for reviewed code. It is not a database feature and will not be available unless the SQL explicitly returns an `id` column.

## Error handling strategy

- Let query errors reject the async operation; do not swallow constraint/type errors with broad conflict-ignore behavior.
- Map PostgreSQL constraint errors deliberately to the existing HTTP status and response shape where possible.
- Preserve existing authentication error behavior and avoid logging passwords, hashes, tokens, connection strings, or sensitive row values.
- Roll back transaction workflows on every error, then release the client.
- Do not expose raw PostgreSQL errors to clients unless the existing API already does so and the behavior has been reviewed.
- Add centralized async error handling only as part of the later route conversion, with response contracts preserved.

## Authentication considerations

No authentication behavior was changed. During later conversion:

- Keep bcrypt password hashes byte-for-byte unchanged and compare them with the existing bcrypt library.
- Preserve username, role, user ID, student/faculty ownership links, parent matching behavior, password-reset OTP handling, JWT claims, and authorization middleware behavior.
- Convert all login and registration queries as one tested slice rather than mixing SQLite and PostgreSQL for related identity operations.
- Never rehash migrated passwords merely because the database driver changed.
- Do not print or expose credentials, hashes, OTPs, JWTs, or `DATABASE_URL`.

## Route conversion strategy

The next implementation should convert bounded slices, not all routes at once:

1. Add async error and transaction helpers around the adapter.
2. Convert authentication and registration in staging, with SQLite still available for rollback.
3. Convert parent lookups and profile reads/updates.
4. Convert read-only student academic routes and compare response payloads.
5. Convert admin/reference reads and dashboard queries.
6. Convert simple CRUD writes using `RETURNING` and `rowCount`.
7. Convert fee/payment, upload/audit, leave-review, notification, and result-import transactions.
8. Convert reports/exports and large result queries with pagination/batching.
9. Keep route names, methods, request bodies, response structures, and status codes stable.
10. Only switch the runtime database selection after staging parity and rollback tests pass.

**Production routes modified in Step 11B:** 0.

**SQLite call sites converted in Step 11B:** 0.

## Rollback strategy

- Existing `server.js` remains SQLite-backed, so the current application path is unchanged.
- The adapter is additive and not imported by production routes.
- The test writes only to temporary PostgreSQL tables inside transactions and commits/rolls back those temporary objects; no production table is written.
- Keep SQLite database files, backups, WAL/SHM files, uploads, `better-sqlite3`, and `database/database.js` until the later runtime observation window passes.
- If a later route conversion fails, revert the staging runtime selection or disable only the converted route slice; do not delete SQLite or PostgreSQL data.
- Do not run destructive SQL as part of adapter testing or rollback.

## Adapter test result

`node database/test-postgres-adapter.js` passed.

The isolated test verified:

- PostgreSQL pool connection;
- `SELECT 1`;
- one-row SELECT;
- multi-row SELECT;
- parameterized `?` conversion;
- question marks inside quoted SQL literals remain unchanged;
- INSERT with `RETURNING id`;
- boolean and JSONB values;
- UPDATE and `rowCount`/`changes`;
- DELETE and `rowCount`/`changes`;
- successful transaction commit;
- transaction rollback after an intentional error;
- temporary-table-only writes, with no production table/data changes.

## Exact next step required after this

**STEP 11C should convert only the authentication/identity slice in a staging-safe mode:** login, student/faculty/admin/parent lookups, registration, password reset, bcrypt verification, JWT creation, and role/ownership checks. Before that implementation, add route-level parity tests against the migrated baseline and decide how startup demo-account/seed writes are disabled for PostgreSQL runtime. Do not convert the remaining 233 SQLite call sites until this first slice passes.

## Final status

- PostgreSQL adapter ready: **Yes**
- Adapter tested: **Yes**
- Existing application still using SQLite: **Yes**
- Production routes modified: **0**
- SQLite call sites converted: **0**
- Data migration performed in this step: **No**
- SQLite files changed: **No**
- PostgreSQL production/application data changed by the adapter test: **No**
- Frontend files changed: **No**

**STEP 11B COMPLETE — POSTGRES ADAPTER READY, EXISTING ROUTES UNCHANGED**
