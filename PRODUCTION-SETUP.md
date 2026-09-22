# KHIT Family Portal Production Preparation

This document prepares the repository for a later deployment. It does not deploy the application or import real college data.

## Step 35 deployment preparation

Run the readiness gate before each deployment candidate:

```text
npm run verify:production
```

The gate checks JavaScript syntax, local HTML references, required production variables, durable upload storage, and whether `server.js` still contains direct SQLite calls. A failure is intentional: it means the candidate is not ready for production traffic.

The intended deployment architecture is:

- Frontend: Vercel static hosting
- Backend: Render Node.js service running `npm start`
- Database: managed PostgreSQL
- Files: S3-compatible durable object storage

Deployment is still preparation-only. Do not deploy until the environment-dependent checks below pass.

## Required environment

Set these values in the hosting environment. Do not commit `.env` or real values.

- `NODE_ENV=production`
- `PORT` and optional `HOST`
- `JWT_SECRET` as a long random secret
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` for an already approved administrative account
- `DATABASE_URL` for managed PostgreSQL
- `FRONTEND_URL` as one or more comma-separated allowed browser origins
- `PGSSL=true` unless the managed database explicitly requires otherwise
- `STORAGE_PROVIDER` and storage credentials when production object storage is available
- For `STORAGE_PROVIDER=s3`, configure `S3_BUCKET` and `S3_REGION`; optionally configure `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, and access credentials or the host IAM role.
- `UPLOAD_MAX_FILE_SIZE_MB`
- SMTP variables if password reset email is enabled

Configure these values in the Render service environment. Configure the frontend API origin in the Vercel deployment without committing it to source. The existing pages load `api-config.js`, which accepts `window.KHIT_API_BASE`; provide that value through an approved Vercel build/injection mechanism or route `/api` to the Render service. Do not use a production localhost value.

For S3-compatible storage, use the existing names `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, and, when required by the provider, `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`. `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` may be omitted only when the hosting platform supplies an equivalent workload identity. Never place these values in Git, HTML, or documentation.

## Start and health checks

```text
npm install
npm start
GET /api/health
GET /api/status
```

In production, `/api/health` checks PostgreSQL when `DATABASE_URL` is configured and returns only service/database status.

## Database preparation

The repository contains `database/postgres-schema.sql` and the non-destructive `npm run db:migrate:postgres` migration utility. Before a real migration:

1. Run `npm run db:backup` against the approved source.
2. Provision a new managed PostgreSQL database.
3. Run the migration in a controlled environment.
4. Compare all table counts, foreign keys, uniqueness rules, sequences, and login flows.
5. Keep the SQLite source and backup until validation and rollback planning are complete.

The migration is transactional, but operational rollback still requires retaining the source backup and database snapshot.

## Runtime verification

Run `npm run verify:production` with the production environment loaded. It must report all required variables, durable object storage, valid syntax and links, and zero direct SQLite calls on production routes. Then start the service and verify `GET /api/health` returns database readiness. Run authenticated smoke tests against the Render service before approving production traffic.

## Demo data

Demo account/content seeding is development-only. Production startup does not run demo/result seeding. Do not import real student, parent, faculty, payment, or academic data into the demo environment.

## Files and storage

Local `uploads/` storage is suitable only for local/demo use. Production uses the S3-compatible adapter when `STORAGE_PROVIDER=s3` (or `object-storage`/`cloud`). Keep protected-file authorization in the application and validate upload type, size, and filenames before enabling production uploads.

## Frontend/API origins

All root pages that make API requests load `api-config.js`. It uses `window.KHIT_API_BASE` when supplied and otherwise uses the current origin, preserving local same-origin development. For Vercel plus Render, inject the reviewed Render API origin before `api-config.js` runs or configure an approved `/api` rewrite. Production CORS on Render must allow the exact Vercel origin through `FRONTEND_URL`; do not use `*`.

## Security notes

- Keep `.env`, database files, uploads, backups, logs, and runtime artifacts out of version control.
- Use managed PostgreSQL TLS and a strong environment-provided JWT secret.
- Keep production CORS restricted to `FRONTEND_URL`.
- Keep authentication, OTP, AI, API, and registration rate limits enabled.
- Review production logging and replace development OTP delivery before enabling parent login for real users.
