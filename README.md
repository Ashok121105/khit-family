# KHIT Family — College Digital Portal Demo

## What this is
KHIT Family is an Express + SQLite college management portal demo for Kallam Haranadhareddy Institute of Technology. It uses the real backend and database with clearly fictional sample records. It does not contain official college data.

## Current demo features
- KHIT Family landing page
- Student / Faculty / Admin demo login
- Student dashboard module cards
- Faculty dashboard module cards
- Admin dashboard module cards
- Latest Updates
- Demo announcement/photo/video update entries
- SQLite-backed REST APIs, authentication, uploads, and role-protected pages
- Responsive mobile design
- Professional academic/institutional theme

## Demo credentials
The app auto-creates quick demo accounts on startup when missing.

- Faculty: `faculty` / `faculty123`
- Student: `student` / `student123`
- Admin: use the existing admin creation flow (`create-admin.js` or the configured admin account); do not use production credentials in demo code.
- Parent match: student_id `STU-1001` with parent mobile `9876500001` or parent email `parent@khit.edu.in`

## Important
The `KHIT` box in the prototype is a placeholder. Replace it with the **official KHIT college logo without changing the logo artwork**.

Demo payments are simulated records. Uploaded files are stored under `uploads/` for local/demo use.

## Run locally

```text
npm install
npm start
```

The server listens on `http://localhost:5000` and initializes the schema and missing demo records without deleting existing data.

## Production migration status

The local demo supports SQLite compatibility, while the active prepared runtime uses PostgreSQL when `DATABASE_URL` is configured. The repository includes:

- `.env.example` with non-secret local and Render configuration placeholders;
- `database/postgres-schema.sql`, including the current module schema and legacy compatibility columns;
- `database/backup-sqlite.js` for a non-destructive SQLite and uploads backup;
- `database/migrate-sqlite-to-postgres.js`, which copies rows inside a PostgreSQL transaction and never deletes the SQLite source;
- `/api/health` for Render health checks and graceful shutdown handling.

Before switching the application runtime to PostgreSQL, run `npm run db:backup`, provision a new PostgreSQL database, set `DATABASE_URL`, run `npm run db:migrate:postgres`, compare every table count with the backup baseline, and test student/admin/parent/faculty logins. Do not delete `database/khit_family.db` until those checks pass.

Render can run the app with build command `npm install` and start command `npm start`. Required variables are `NODE_ENV=production`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `FRONTEND_URL`, and `DATABASE_URL`, plus SMTP variables if password reset email is enabled. Render local disk and `uploads/` are not permanent production storage. See [PRODUCTION-SETUP.md](PRODUCTION-SETUP.md) for the current readiness assessment and remaining PostgreSQL route/storage work.

The frontend is currently served by Express from the repository root. Root pages that call the API load `api-config.js`; a separate Vercel deployment must inject `window.KHIT_API_BASE` with the approved Render API origin or configure a Vercel `/api` rewrite. Do not deploy this mixed repository as a static frontend and assume `/api` will reach Render.

## Scalability work and limits

The current code includes:

- indexes for common student, faculty, fee, attendance, marks, notification, assignment, document, leave, and bus lookups;
- bounded pagination and search on the main admin and student collections;
- request-body limits, upload-size limits, collision-resistant upload names, and centralized API errors;
- a lightweight per-process API rate limiter;
- SQLite WAL mode, foreign keys, and a busy timeout for local concurrent requests.
- optional student LinkedIn, GitHub, Instagram, portfolio, and other professional links stored in SQLite and editable from Settings.

Local regression testing verified 60 concurrent authenticated notification requests and paginated admin lists. This is not a production load test and does not guarantee support for a specific number of simultaneous users. Before serving 5,000+ users, run an authenticated load test, move to PostgreSQL with a connection pool, use shared rate limiting, and move uploads to persistent object storage.

## Future production integration
For official KHIT integration:
- College-provided student/faculty data
- Official bus routes and stops
- Fees and receipts
- Attendance, marks and results
- Admin content management
- Photos, videos and PDFs
- Role-based authentication and permissions
- Payment gateway, if authorized by the college

1. Replace only the seed routine with an approved import process.
2. Map official departments, students, faculty, and academic records to the existing schema.
3. Validate role mappings and student ownership before enabling production access.
4. Migrate SQLite data to PostgreSQL and move uploads to persistent object storage.

Do not put real student private information into the demo environment.
