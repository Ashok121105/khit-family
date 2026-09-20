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

## Render limitation

The app honors `process.env.PORT` and binds to `0.0.0.0`. SQLite and local uploads are acceptable for this demo, but Render filesystem storage is not a production persistence strategy. A future official deployment should migrate SQLite to PostgreSQL and uploads to object storage.

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
