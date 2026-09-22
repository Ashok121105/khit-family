# STEP 11A: SQLite Runtime Audit

## 1. Executive summary

The Express runtime is still SQLite-backed. `server.js` imports `./database/database`, which opens `database/khit_family.db` through synchronous `better-sqlite3`; every database-backed route uses that synchronous handle. The PostgreSQL pool exists and is connection-tested, but no runtime route imports it.

The current audit found:

- **233 direct SQLite API references in `server.js`:** 223 `db.prepare(...)` and 10 `db.exec(...)` calls.
- **244 SQLite API references across backend JavaScript:** `server.js` 233; `create-admin.js` 2; `database/database.js` 4; `database/migrate-sqlite-to-postgres.js` 5.
- **72 Express route declarations:** 68 contain direct SQLite calls; 4 are non-database/static/status routes.
- **PostgreSQL layer:** correctly loads the project-root `.env`, creates a `pg.Pool`, supports SSL configuration, and has a successful connection test. It is not yet used by `server.js`.
- **`package.json`:** already contains `pg`; no dependency addition is required for Step 11B.
- **High-risk patterns:** synchronous `.get()/.all()/.run()`, startup writes and seed generation, SQLite schema mutation, `?` placeholders, `lastInsertRowid`, `.changes`, SQLite `datetime('now')`, and a large number of routes whose response logic assumes immediate synchronous result objects.

No runtime code was changed by this audit. SQLite, uploads, authentication behavior, routes, and frontend files remain unchanged.

## 2. Files inspected

- `server.js`
- `database/database.js`
- `database/postgres.js`
- `database/postgres-schema.sql`
- `database/migrate-sqlite-to-postgres.js`
- `database/test-postgres.js`
- `database/backup-sqlite.js`
- `database/schema.sql`
- `create-admin.js`
- `package.json`
- `app.js` was checked as frontend/browser code and does not import SQLite or PostgreSQL.

Other HTML/CSS/theme files were not runtime database modules.

## 3. All files using SQLite

### `server.js`

- Imports the SQLite handle from `./database/database`.
- Contains 233 direct SQLite API references: 223 `db.prepare` and 10 `db.exec`.
- Performs startup schema loading, compatibility alters/updates, demo-account creation, seed inserts, authentication queries, and all database-backed API route reads/writes.

### `create-admin.js`

- Imports `./database/database`.
- Performs a synchronous user lookup and insert.
- Uses `result.lastInsertRowid`.
- Hashes a new password with bcrypt; this is a separate admin utility and must be migrated only after authentication cutover is verified.

### `database/database.js`

- Imports `better-sqlite3`.
- Builds the database path from `__dirname` and `khit_family.db`.
- Opens the SQLite database synchronously.
- Executes `foreign_keys`, `busy_timeout`, and `journal_mode = WAL` pragmas.

### `database/migrate-sqlite-to-postgres.js`

- Imports the SQLite handle and uses SQLite catalog/data reads for the one-time migration utility.
- Its SQLite dependency is intentional for migration and should remain available through rollback verification.
- It must not be treated as runtime code for the PostgreSQL application cutover.

### SQLite-adjacent helper

`database/backup-sqlite.js` does not open SQLite through `better-sqlite3`, but it directly assumes the local SQLite files `khit_family.db`, `khit_family.db-shm`, and `khit_family.db-wal`, and copies the local `uploads/` directory. It must remain available until the PostgreSQL runtime and file storage are verified.

## 4. Every SQLite database call in `server.js`

The following is the complete direct-call index from the current `server.js`. The list is by API and source line; multiline SQL begins at the listed call line. This avoids reproducing row values, credentials, or secret fields while still enumerating every call site.

### `db.prepare(...)` call sites: 223

```text
202, 203, 208, 211, 212, 254,
307, 337, 354, 585, 653, 661, 668, 675, 682, 691, 696, 742, 787, 796, 801,
817, 824, 831, 837, 839, 843, 847, 853, 860, 866, 873, 880, 888, 895, 897,
901, 922, 927, 939, 942, 953, 977, 980, 990, 1006, 1013, 1014, 1015,
1016, 1021, 1026, 1040, 1045, 1053, 1055, 1094, 1098, 1099, 1103, 1105,
1359, 1403, 1417, 1461, 1475, 1488, 1494, 1531, 1541, 1567, 1633, 1646,
1657, 1710, 1781, 1799, 1805, 1845, 1852, 1875, 1876, 1907, 1921, 1926,
1958, 1963, 1974, 1975, 2011, 2078, 2116, 2138, 2164, 2186, 2219, 2250,
2260, 2286, 2308, 2446, 2470, 2503, 2523, 2627, 2697, 2719, 2759, 2772,
2773, 2774, 2775, 2833, 2877, 2988, 3050, 3063, 3073, 3087, 3105, 3139,
3152, 3166, 3184, 3191, 3254, 3376, 3384, 3419, 3556, 3571, 3619, 3632,
3679, 3691, 3736, 3749, 3756, 3811, 3824, 3836, 3876, 3888, 3925, 3931,
3974, 3979, 4036, 4044, 4077, 4086, 4122, 4128, 4176, 4190, 4224, 4264,
4273, 4315, 4352, 4392, 4406, 4415, 4423, 4475, 4536, 4618, 4620, 4631,
4666, 4679, 4714, 4727, 4734, 4774, 4806, 4827, 4862, 4868, 4874, 4923,
4970, 5026, 5068, 5074, 5113, 5146, 5159, 5210, 5252, 5305, 5318, 5350,
5400, 5413, 5444, 5457, 5498, 5511, 5528, 5572, 5585, 5637, 5650, 5723,
5736, 5790, 5803, 5811, 5870, 5890, 5902, 5929, 5945, 5963, 6052, 6122,
6127, 6151, 6156, 6185, 6220, 6254
```

### `db.exec(...)` call sites: 10

```text
331, 348, 356, 404, 467, 494, 533, 565, 607, 1062
```

### What those calls do

- Lines 202-289: result seed checks, possible result deletion, result seed inserts.
- Lines 307-467: SQLite `PRAGMA table_info`, dynamic `ALTER TABLE`, legacy compatibility updates, schema loading.
- Lines 467-607: startup table creation for notification links, settings, and password-reset OTPs.
- Lines 653-1105: startup admin/student/faculty/demo data checks and inserts, fee/subject/attendance/marks/notification seeds, department/year/user/faculty/subject seeds.
- Lines 1359-2308: upload/document/authentication/password-reset/admin/student/faculty/parent route queries.
- Lines 2446-2877: registration, login, role/profile lookup, startup/demo metrics and account operations.
- Lines 2988-3254: student dashboard, profile, fee, attendance, marks, and notification reads.
- Lines 3376-4475: admin student/faculty/fee/bus/event/announcement/statistics/report operations.
- Lines 4536-4874: student profile update, fees, fee payments, and audit writes.
- Lines 4923-5228: assignments, documents, placements, internships, study materials, and uploads.
- Lines 5252-5528: leave requests, reviews, exams, marks, and result reads.
- Lines 5572-6254: result analytics/import/publication, notifications, reports, and related admin/student queries.

## 5. Route inventory and SQLite dependence

There are **72 route declarations** in `server.js`. **68 route blocks contain a direct SQLite call.** The four route declarations without a direct SQLite call are the static/status/health/demo-information paths: `/`, `/api/status`, `/api/health`, and `/api/demo-credentials`.

### Authentication and identity routes

- `POST /api/login` at the current route block beginning near line 1984
- `POST /api/student/register`
- `POST /api/faculty/login`
- `POST /api/student/login`
- `POST /api/parent/login`
- `POST /api/admin/login`
- `POST /api/password-reset/request`
- `POST /api/password-reset/confirm`
- `POST /api/admin-password-reset/request`
- `POST /api/admin-password-reset/confirm`

These use `users`, `students`, `faculty`, `password_reset_otps`, bcrypt comparison/hash logic, JWT creation, and role/ownership queries. They must be migrated as a single compatibility-tested slice; changing only one login route would create inconsistent authentication behavior.

### Admin routes

- Uploads/documents: `POST /api/admin/uploads`, `GET /api/admin/documents`, `POST /api/admin/documents`, `DELETE /api/admin/documents/:id`
- Settings: `GET /api/admin/settings`, `PUT /api/admin/settings`
- Students: `GET /api/admin/students`, export, import preview
- Faculty: `GET /api/admin/faculty`, `POST /api/admin/faculty`, `DELETE /api/admin/faculty/:id`
- Fees: `GET /api/admin/fees`, `POST /api/admin/fees`, `DELETE /api/admin/fees/:id`
- Bus: `GET /api/admin/buses`, create bus, add stops, delete bus
- Events/announcements: list/create/publish/delete events and create/list announcements
- Analytics/reports: `GET /api/admin/stats`, `GET /api/admin/reports`
- Leave: list and review leave requests
- Results: analytics, import, publish
- Notifications: list/create/delete
- Materials: `POST /api/admin/materials`

### Student routes

- Profile read/update
- Academics
- Fees and fee payment
- Bus
- Assignments
- Documents
- Placements
- Internships
- Study materials
- Leave request read/create
- Exams, attendance, marks, results
- Notifications, unread count, mark-read

### Faculty routes

Faculty login/dashboard and admin faculty management use `users` and `faculty`. Faculty-related assignment, leave-review, timetable, and result ownership queries are embedded in the broader route groups above.

### Parent routes

`POST /api/parent/login`, `GET /api/parent/dashboard`, and `GET /api/parent/student-profile` use the parent fields stored on `students` (`parent_mobile`, `parent_email`, `parent_name`, and related profile data). There is no separate parent table or parent user table.

## 6. Operation categories

### SELECT

There are 181 lexical `SELECT` occurrences in `server.js`, including direct lookups, joins, counts, dashboard summaries, scalar subqueries, pagination, search, and validation. They cover users, students, faculty, parent matching, fees, attendance, marks, results, notifications, documents, assignments, leave, bus, events, materials, placements, internships, settings, and reports.

### INSERT

There are 64 lexical `INSERT` occurrences. They include startup/demo seeding and request-time creation of users, profiles, fees, payments, attendance, marks, notifications, assignments, documents, leave requests, events, announcements, buses/stops, materials, results, audit logs, and settings. Ten are `INSERT OR IGNORE`, which must become explicit PostgreSQL conflict targets.

### UPDATE

There are 20 lexical `UPDATE` occurrences. They include startup legacy normalization, profile/settings edits, leave reviews, event publication, notification read state, fee balances, result review/publication, and other admin edits.

### DELETE

There are 24 lexical `DELETE` occurrences. They include result seed cleanup, default-demo-admin removal, and admin deletes for faculty, fees, buses, events, notifications, and documents. PostgreSQL conversion must preserve intended endpoint behavior and transaction boundaries; startup deletes require special approval before PostgreSQL runtime activation.

### Transactions

No application-level `db.transaction(...)` wrapper was found in `server.js`. `better-sqlite3` statements execute synchronously and individually unless an explicit transaction is added. The migration utility uses an explicit PostgreSQL `BEGIN/COMMIT/ROLLBACK`; this does not protect runtime requests. Step 11B must add deliberate PostgreSQL transactions around multi-write operations such as registration, fee payment, result import, uploads plus audit logs, and related settings/content operations.

### Startup/init

Startup performs all of the following before the server listens:

1. Loads `database/schema.sql` through `db.exec`.
2. Adds missing columns using `PRAGMA table_info` and SQLite `ALTER TABLE`.
3. Runs legacy data-normalization `UPDATE`s.
4. Creates notification link, settings, and password-reset tables.
5. Inserts default app settings using `INSERT OR IGNORE`.
6. Runs result seed checks and may delete/rebuild `result_records`.
7. Creates or removes demo/admin accounts.
8. Creates demo student/faculty records and sample fees, subjects, attendance, marks, notifications, and other records.
9. Continues into route registration and server startup.

This startup behavior cannot be pointed at PostgreSQL unchanged. In particular, `ensureResultSeedData()` can delete production results, and `ensureDemoAccounts()` can create/delete users.

## 7. SQLite-specific SQL and runtime features requiring conversion

1. **Driver/API:** synchronous `better-sqlite3` `.prepare().get()`, `.all()`, `.run()`, and `.exec()` must become asynchronous `pg` calls.
2. **Placeholders:** SQLite uses `?`; PostgreSQL uses `$1`, `$2`, and so on. Dynamic SQL builders must maintain parameter order and quote identifiers safely.
3. **Generated IDs:** `result.lastInsertRowid` must become `INSERT ... RETURNING id`.
4. **Affected rows:** `result.changes` must become `result.rowCount` with explicit handling for `UPDATE`/`DELETE` semantics.
5. **Ignore syntax:** `INSERT OR IGNORE` must become an explicit `ON CONFLICT (...) DO NOTHING` only where the conflict policy is known.
6. **Catalog/introspection:** `sqlite_master` and `PRAGMA table_info` are SQLite-only. Runtime schema mutation must be removed from normal PostgreSQL application startup and replaced by controlled schema deployment/migrations.
7. **Pragmas:** `foreign_keys`, `busy_timeout`, and `journal_mode = WAL` have no PostgreSQL equivalent in query code. Pooling, transactions, and PostgreSQL constraints replace them.
8. **SQLite types:** integer flags (`0/1`) must match PostgreSQL booleans; `REAL` amounts/marks must be handled as `NUMERIC`; `DATETIME`/date text needs explicit timezone/date policy; `metadata TEXT` is converted to `JSONB` only after validation.
9. **Functions:** `CURRENT_TIMESTAMP` is broadly available but timestamp type/timezone behavior differs; `datetime('now')` is SQLite-specific and must become `CURRENT_TIMESTAMP` or an application parameter. `COALESCE`, `CASE`, `COUNT`, `SUM`, `GROUP BY`, joins, and scalar subqueries require type/comparison testing.
10. **SQLite affinity:** PostgreSQL is stricter about boolean, numeric, date, nullability, and implicit casts. Search and ordering behavior must be regression-tested.
11. **SQLite dynamic compatibility:** legacy column creation and in-place normalization in `server.js` must not run against the migrated PostgreSQL database. The already prepared PostgreSQL schema contains compatibility columns, but runtime code must use an intentional canonical mapping.
12. **File paths:** local `/uploads/...` values in documents/media/assignment/material records remain database references, not file migration. Runtime storage and file deletion behavior must be verified separately.

## 8. Synchronous code that cannot be mechanically replaced

The following patterns require an async control-flow redesign, not a text substitution:

- Every route handler that calls `.get()`, `.all()`, or `.run()` and immediately uses the returned value.
- Sequential dependent writes, especially user insert followed by student/faculty insert using `lastInsertRowid`.
- Loops that perform many synchronous inserts, such as result imports/seeding, attendance/marks seed data, and bulk imports.
- Dynamic update builders that call `db.prepare(sql.join(" ")).run(...params)`.
- Upload handlers that save a file, insert a document/audit record, and delete the file on database failure.
- Fee payment handlers that insert a payment and update fee balances; these need a PostgreSQL transaction.
- Registration/authentication code that currently returns synchronously from the database call inside an Express callback.
- Startup initialization, which currently executes before the app begins serving requests and may perform writes.

The safe conversion pattern is `async` handlers with `await pool.query(...)`, explicit result extraction (`result.rows[0]`, `result.rowCount`), and `pool.connect()` transactions where multiple statements must succeed together.

## 9. Potential breaking points

- **Startup data loss risk:** result seed cleanup and default-admin removal must be disabled or made explicitly environment-gated before PostgreSQL runtime use.
- **Duplicate assumptions:** the migrated PostgreSQL data intentionally has one retained bus assignment for the 28 exact SQLite duplicates; runtime writes must honor the PostgreSQL logical uniqueness constraint.
- **Schema drift:** live legacy columns differ from canonical names in documents, assignments, leave, buses, events, content, internships, placements, and timetable. Route queries must target the actual PostgreSQL schema deliberately.
- **Nullability differences:** PostgreSQL target staging columns are permissive in several legacy areas, but runtime inserts and future constraints may still reject values that SQLite accepted.
- **Date handling:** `DATE` results from node-postgres can be represented as timezone-shifted JavaScript `Date` objects; date-only code must avoid accidental day shifts.
- **JSONB:** invalid legacy `audit_logs.metadata` would fail strict JSON conversion; runtime writes should send objects or validated JSON.
- **ID/sequence behavior:** explicit migrated IDs require sequences to remain ahead of the maximum ID; new writes must use `RETURNING id`.
- **Authentication:** bcrypt hashes must be compared exactly as stored; role, student ownership, parent lookup, password reset, JWT payload, and admin restrictions must be regression-tested together.
- **Error timing:** asynchronous failures occur through rejected promises, so every handler needs a single response path and `try/catch` or centralized async error handling.
- **Connection behavior:** long reports/imports may need a checked-out client and transaction; ordinary reads should use the pool without leaking clients.
- **Upload cleanup:** database/file consistency can regress if a PostgreSQL insert fails after multer has written a file.
- **PostgreSQL strictness:** type casts, boolean predicates, `ILIKE`/case behavior, `LIMIT/OFFSET`, null ordering, and date comparisons may change response results.

## 10. Recommended safe migration strategy for STEP 11B

1. Keep SQLite as the active runtime and preserve the database backup, `.db` files, WAL/SHM files, and uploads.
2. Add a PostgreSQL repository/query adapter without changing route contracts. Start with a small shared query helper that exposes `query`, transaction clients, and normalized result helpers.
3. Establish a staging configuration that points only the backend process to PostgreSQL while frontend files and API paths remain unchanged.
4. Disable all destructive/demo startup writes for PostgreSQL. Replace schema loading with deployment-time schema management; do not run SQLite `schema.sql` or PRAGMA code.
5. Convert authentication and account lookup first in a staging process: login, registration, parent matching, password reset, role checks, bcrypt verification, and JWT creation.
6. Convert read-only routes by domain and compare SQLite/PostgreSQL responses using the migrated baseline.
7. Convert simple single-write routes with `RETURNING`, `rowCount`, and explicit transactions where needed.
8. Convert multi-write routes: registration, payments, result import, uploads/documents plus audit, leave review, notification read/update, and settings.
9. Convert admin bulk/import/report paths with batched PostgreSQL queries and bounded pagination.
10. Run route-by-route parity tests against representative student, parent, faculty, and admin accounts, including negative authorization cases.
11. Run a controlled staging soak test and verify counts, sums, identity sequences, foreign keys, unique constraints, password hashes, uploads, audit logs, and health checks.
12. Only after approval change the production runtime database dependency. Keep SQLite and `better-sqlite3` available for rollback until an observation window passes.

## 11. Exact order for converting `server.js`

1. **Imports and infrastructure:** introduce the PostgreSQL pool/repository and async error handling; retain SQLite import behind an explicit staging flag until cutover.
2. **Startup initialization:** remove runtime SQLite schema/PRAGMA/legacy mutation; replace demo seed calls with an opt-in non-production seed command.
3. **Shared helpers:** replace `lastInsertRowid`, `.changes`, pagination/query helpers, transaction helpers, and date/boolean/JSON normalization.
4. **Authentication core:** common login/user lookup, bcrypt verification, JWT creation, role checks, password reset, and admin credential checks.
5. **Registration:** student and faculty registration, user-to-profile creation transactions, uniqueness/error mapping.
6. **Parent access:** parent login, dashboard, and student-profile lookup.
7. **Profile reads/updates:** student, faculty, and admin profile paths.
8. **Reference/admin reads:** departments, academic years, subjects, settings, and dashboard counts.
9. **Student academic reads:** academics, fees, attendance, marks, exams, results, notifications, bus, assignments, documents, placements, internships, materials, and leave.
10. **Admin CRUD:** students, faculty, fees, buses/stops, events, announcements, notifications, leave review, and settings.
11. **Financial writes:** fee payments and reimbursement with balance-update transactions.
12. **Learning/content writes:** assignments, submissions, study materials, events, announcements, documents, uploads, and audit logs.
13. **Results:** analytics, import, review/publication, and student results; bulk operations must be batched and transactional.
14. **Reports/exports:** dashboard reports, exports, grouped summaries, and large pagination queries.
15. **Server lifecycle:** health/shutdown/pool closing, then staging parity tests before production switch.

## 12. Files that must NOT be changed yet

For this Step 11A audit, no runtime file was changed. Until the Step 11B implementation is explicitly approved, do not change:

- `server.js`
- `create-admin.js`
- `database/database.js`
- frontend HTML/JS/CSS files
- authentication behavior or API route contracts
- `database/khit_family.db`, `database/khit_family.db-wal`, or `database/khit_family.db-shm`
- `uploads/`

The audit document itself is the only new file from this step.

## 13. Dependencies that can only be removed after runtime verification

- `better-sqlite3` must remain installed until the PostgreSQL runtime passes authentication, route, upload, reporting, rollback, and observation-window checks.
- `database/database.js` must remain available for SQLite rollback and source verification.
- SQLite backup tooling and `.db`/WAL/SHM files must remain available until rollback is no longer authorized.
- `pg` is already present in `package.json` and does not need to be added.
- `bcryptjs`, `jsonwebtoken`, `multer`, and related dependencies must not be removed or changed as part of the database switch; they are part of authentication/upload behavior.

## 14. Final STEP 11B checklist

### Before implementation

- [ ] Freeze the migrated PostgreSQL baseline counts and sequence positions.
- [ ] Confirm SQLite backup, live SQLite files, WAL/SHM files, and uploads are preserved.
- [ ] Confirm no production runtime points at PostgreSQL yet.
- [ ] Add staging-only configuration and a rollback switch.
- [ ] Decide which startup demo/seed routines are disabled for PostgreSQL.
- [ ] Define route-level parity tests and sensitive-field redaction rules.

### During implementation

- [ ] Convert one bounded domain at a time in the order above.
- [ ] Replace every `?` placeholder with numbered PostgreSQL parameters.
- [ ] Replace every `lastInsertRowid` with `RETURNING id`.
- [ ] Replace every `.changes` check with `rowCount` semantics.
- [ ] Add explicit transactions for multi-write workflows.
- [ ] Preserve bcrypt hashes, JWT claims, roles, ownership, nulls, dates, numeric values, and upload paths.
- [ ] Do not run SQLite PRAGMA/schema mutation against PostgreSQL.
- [ ] Do not use broad `ON CONFLICT DO NOTHING` to hide runtime data errors.
- [ ] Keep route paths and response contracts unchanged.

### After each domain

- [ ] Run syntax/type/lint checks.
- [ ] Run focused route tests and authorization-negative tests.
- [ ] Compare SQLite/PostgreSQL response data and aggregates.
- [ ] Check PostgreSQL logs for rejected casts, constraint errors, leaked clients, or unhandled promise rejections.
- [ ] Verify uploaded files and audit-log records for upload workflows.

### Before production cutover

- [ ] Test admin, faculty, student, and parent authentication without exposing credentials.
- [ ] Verify password hashes were not changed or rehashed.
- [ ] Verify all 36 table counts, foreign keys, unique constraints, primary keys, and identity sequences.
- [ ] Verify results, fees, attendance, notifications, documents, leave, bus, events, assignments, placements, internships, materials, and reports.
- [ ] Run concurrency and connection-pool tests.
- [ ] Confirm SQLite remains an untouched rollback source.
- [ ] Keep `better-sqlite3` installed through the agreed observation window.
- [ ] Only then switch the production runtime and monitor health/error metrics.

## Final status

- **Files inspected:** `server.js`, `database/database.js`, `database/postgres.js`, `database/postgres-schema.sql`, `database/migrate-sqlite-to-postgres.js`, `database/test-postgres.js`, `database/backup-sqlite.js`, `database/schema.sql`, `create-admin.js`, `package.json`, and `app.js`.
- **SQLite database call sites:** 233 direct references in `server.js`; 244 SQLite API references across backend JavaScript files.
- **Routes depending on SQLite:** 68 of 72 Express route declarations.
- **PostgreSQL connection layer ready:** Yes for connection pooling and environment loading; not yet integrated into runtime routes.
- **Does `package.json` need `pg`?** No. `pg` is already declared.
- **High-risk synchronous patterns:** 223 synchronous `db.prepare` calls, synchronous `.get/.all/.run` result assumptions, startup writes/schema mutation, `lastInsertRowid`, `.changes`, `?` placeholders, SQLite pragmas/catalogs, SQLite date/boolean/type-affinity behavior, and multi-write workflows without explicit runtime transactions.

**STEP 11A AUDIT COMPLETE — NO RUNTIME CHANGES MADE**
