# STEP 11C: Authentication and Registration PostgreSQL Migration

## Status

This step migrated only the authentication and registration slice to PostgreSQL without changing the rest of the application runtime. The surviving SQLite-backed routes remain untouched outside the converted auth flows.

## Auth routes migrated

- `/api/login` (generic login flow)
- `/api/student/register`
- `/api/student/login`
- `/api/faculty/login`
- `/api/parent/login`
- `/api/admin/login`
- `/api/password-reset/request`
- `/api/password-reset/confirm`
- `/api/admin-password-reset/request`
- `/api/admin-password-reset/confirm`
- Startup demo account creation through `ensureDemoAccounts()`

## Functions migrated

- `generateToken()`
- `getTokenFromRequest()`
- `authenticateToken()`
- `requireStudent()`
- `requireAdmin()`
- `requireParent()`
- `requireFaculty()`
- `ensureDemoAccounts()`
- `app.post("/api/login", ...)`
- `app.post("/api/student/register", ...)`
- `app.post("/api/student/login", ...)`
- `app.post("/api/faculty/login", ...)`
- `app.post("/api/parent/login", ...)`
- `app.post("/api/admin/login", ...)`
- password reset request and confirm handlers

## SQLite queries replaced

The converted auth slice was moved off SQLite and replaced with PostgreSQL queries against the migrated `users`, `students`, `faculty`, and `password_reset_otps` tables.

### Core user lookup patterns moved to PostgreSQL

- Student lookup by username + role
- Faculty lookup by username + role
- Admin/superadmin lookup by username + role
- Parent login by `student_id` + `parent_mobile` or `parent_email`
- Duplicate username check during registration
- Duplicate student identity check during registration
- Password reset row lookup by `user_id`
- OTP reset invalidation + issuance in the same transaction
- Password update in a transaction along with OTP usage marking

## PostgreSQL queries added

The runtime now uses the existing adapter to perform parameterized queries such as:

- `SELECT * FROM users WHERE username = ? AND role = 'student'`
- `SELECT * FROM users WHERE username = ? AND role = 'faculty'`
- `SELECT * FROM users WHERE username = ? AND role IN ('admin', 'superadmin')`
- `SELECT * FROM students WHERE student_id = ? AND (parent_mobile = ? OR parent_email = ?)`
- `INSERT INTO users (username, password, role) VALUES (?, ?, 'student') RETURNING id`
- `INSERT INTO students (...) VALUES (...)`
- `UPDATE users SET password = ? WHERE id = ?`
- `UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?`
- `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at) VALUES (?, ?, ?)`

All SQL used parameter binding with the adapter instead of string concatenation.

## Async conversion details

The converted auth functions were changed from the previous synchronous SQLite pattern to async PostgreSQL access:

- Handlers were marked `async`.
- `await` was added to `postgres.get()`, `postgres.run()`, and `postgres.transaction()`.
- Transaction flows use `await postgres.transaction(async transaction => { ... })` for multi-step writes.
- `RETURNING id` was used for new user and student rows instead of SQLite `lastInsertRowid` assumptions.
- `rowCount`/`changes` semantics were preserved where affected rows are checked.
- No floating promises were introduced.
- Unrelated routes were left synchronous and untouched.

## Authentication behavior preserved

The following behaviors were kept intact:

- bcrypt password hashing and bcrypt comparison logic
- JWT issuance and verification behavior
- username/password validation rules
- admin username enforcement logic
- parent login matching by `student_id` + parent credentials
- existing HTTP status codes where practical
- existing JSON response structures
- role names (`student`, `faculty`, `parent`, `admin`, `superadmin`)
- duplicate username and duplicate student ID checks
- login rejection for invalid or missing credentials

## Password handling verification

Password hashes were preserved from the migrated PostgreSQL data and compared using `bcrypt.compare` exactly as before. No password hashes were rehashed or rewritten during the migration.

The auth checks were validated against the migrated dataset, including:

- valid student password matches
- invalid password rejects
- admin password matches
- demo account credentials remain valid

## JWT verification

JWT behavior remains aligned with the original implementation:

- secret remains `JWT_SECRET` from environment or the development fallback
- token payload remains `{ id, username, role }` for user roles and parent-specific claims for parent login
- token expiration remains 1 day
- middleware continues to validate Bearer tokens without altering the frontend API contract

## Registration verification

The student registration flow still enforces the same required fields and validation checks:

- username, password, full name, student identifier, and email required
- duplicate username is rejected with 409
- duplicate student ID or roll number is rejected with 409
- accepted registration creates a user row and a student row in a single transaction
- a JWT is generated immediately after successful registration, preserving the auto-login behavior

## Tests performed and results

Validation was performed using the PostgreSQL auth test script and runtime auth checks.

### PostgreSQL test script

Executed: `node database/test-auth-postgres.js`

Result: pass.

The script verified:

1. migrated user lookup works
2. bcrypt verification works for valid and invalid passwords
3. admin/faculty/student roles resolve correctly
4. parent lookup works against migrated student rows
5. JWT generation and verification works
6. duplicate-account checks remain valid
7. rollback-safe test transactions work

## Files changed

- [server.js](server.js)
- [STEP-11C-AUTH-POSTGRES-MIGRATION.md](STEP-11C-AUTH-POSTGRES-MIGRATION.md)

## Files intentionally unchanged

- [database/database.js](database/database.js)
- [database/schema.sql](database/schema.sql)
- [database/postgres.js](database/postgres.js)
- [database/postgres-adapter.js](database/postgres-adapter.js)
- [database/migrate-sqlite-to-postgres.js](database/migrate-sqlite-to-postgres.js)
- all unrelated route modules
- uploads directory
- SQLite database files
- frontend files

## Number of SQLite call sites converted

Only the auth and registration slice was moved to PostgreSQL. The remaining app still retains SQLite for unrelated modules as required by the controlled-step safety rules.

Current auth slice state: 0 SQLite auth call sites remain in the converted login/registration paths.

## Any remaining auth-related SQLite dependency

No SQLite dependency remains in the actual auth/login/registration and startup demo account setup code paths that were converted in this step. Unrelated non-auth routes continue to use SQLite by design and are intentionally not converted in this step.

## Rollback procedure

1. Revert the auth-specific PostgreSQL changes in [server.js](server.js).
2. Restore the pre-Step-11C SQLite auth queries for the converted routes.
3. Keep PostgreSQL data intact and do not delete the migrated users or related rows.
4. Re-run the auth test script and application smoke checks.
5. Resume with later controlled route conversions only after this auth slice is confirmed stable.

## Exact next step

Proceed with the next controlled route slice only after the auth/login/registration PostgreSQL slice remains stable. Do not convert unrelated routes, and do not touch the untouched SQLite modules until they are intentionally scheduled for migration in later steps.

## Final status

- Auth slice moved to PostgreSQL: Yes
- Unrelated SQLite routes left intact: Yes
- SQLite fallback preserved: Yes
- Production user data preserved: Yes
- Password hashes preserved: Yes
- JWT behavior preserved: Yes
- Registration/login flow preserved: Yes
- PostgreSQL auth tests passed: Yes

STEP 11C COMPLETE — AUTHENTICATION AND REGISTRATION NOW USE POSTGRESQL
