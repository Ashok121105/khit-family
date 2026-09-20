// ============================================================
// KHIT FAMILY PORTAL
// Complete Backend Server
// Node.js + Express + SQLite
// ============================================================

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const multer = require("multer");
const XLSX = require("xlsx");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const db = require("./database/database");

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET =
    process.env.JWT_SECRET || "khit_family_secret_2026";
const ALLOWED_ADMIN_USERNAME = "Ashok1211";
const ALLOWED_ADMIN_PASSWORD = "Ashok@1211";

const uploadDirectory = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDirectory)) {
    fs.mkdirSync(uploadDirectory, { recursive: true });
}

const allowedUploadExtensions = new Set([
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".mp4"
]);

const upload = multer({
    storage: multer.diskStorage({
        destination: uploadDirectory,
        filename: (req, file, callback) => {
            const extension = path.extname(file.originalname).toLowerCase();
            const baseName = path
                .basename(file.originalname, extension)
                .replace(/[^a-zA-Z0-9_-]/g, "-")
                .slice(0, 60);

            callback(
                null,
                `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${baseName || "upload"}${extension}`
            );
        }
    }),
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        callback(null, allowedUploadExtensions.has(extension));
    }
});


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors());

app.use(express.json({ limit: "1mb" }));

app.use(express.urlencoded({
    extended: true,
    limit: "1mb"
}));

function getPagination(req, defaults = {}) {
    const defaultLimit = defaults.defaultLimit ?? 5000;
    const maxLimit = defaults.maxLimit ?? 5000;
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const requestedPage = Number.parseInt(req.query.page, 10);
    const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), maxLimit)
        : defaultLimit;
    const page = Number.isFinite(requestedPage)
        ? Math.max(requestedPage, 1)
        : 1;

    return {
        page,
        limit,
        offset: (page - 1) * limit
    };
}

function getSearchTerm(req) {
    const search = String(req.query.search || "").trim();
    return search.length > 100 ? search.slice(0, 100) : search;
}

function createRateLimiter({ windowMs, max, message }) {
    const clients = new Map();
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of clients) {
            if (entry.resetAt <= now) clients.delete(key);
        }
    }, windowMs);
    cleanupInterval.unref();

    return (req, res, next) => {
        const key = req.ip || req.socket.remoteAddress || "unknown";
        const now = Date.now();
        let entry = clients.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            clients.set(key, entry);
        }

        entry.count += 1;
        if (entry.count > max) {
            res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
            return res.status(429).json({ status: "error", message });
        }

        return next();
    };
}

function getResultGrade(marks) {
    if (!Number.isFinite(Number(marks))) return "F";
    const score = Number(marks);
    if (score >= 90) return "O";
    if (score >= 85) return "A+";
    if (score >= 75) return "A";
    if (score >= 65) return "B+";
    if (score >= 55) return "B";
    if (score >= 45) return "C";
    return "F";
}

function getGradePoint(grade) {
    const map = {
        O: 10,
        "A+": 9,
        A: 8,
        "B+": 7,
        B: 6,
        C: 5,
        F: 0
    };
    return Number(map[grade] || 0);
}

function derivePassStatus(totalMarks) {
    return Number(totalMarks) >= 40 ? "Pass" : "Fail";
}

function ensureResultSeedData() {
    const existingCount = db.prepare(`SELECT COUNT(*) AS count FROM result_records`).get().count;
    const failCount = db.prepare(`SELECT COUNT(*) AS count FROM result_records WHERE pass_status = 'Fail'`).get().count;

    if (existingCount > 0 && failCount > 0) return;

    if (existingCount > 0) {
        db.prepare(`DELETE FROM result_records`).run();
    }

    const studentIds = db.prepare(`SELECT id FROM students ORDER BY id ASC`).all().map((row) => row.id);
    const adminUserIds = db.prepare(`SELECT id FROM users ORDER BY id ASC`).all().map((row) => row.id);
    const createdBy = adminUserIds.length ? adminUserIds[0] : null;

    if (!studentIds.length) {
        console.log("Result seed skipped: no student records available yet.");
        return;
    }

    const academicYear = "2026-27";
    const departments = ["CSE", "ECE", "EEE", "ME", "CE"];
    const yearLabels = [1, 2, 3, 4];
    const subjectMap = {
        CSE: ["Data Structures", "DBMS", "Operating Systems", "Java Programming", "Computer Networks"],
        ECE: ["Digital Electronics", "Signals and Systems", "Microprocessors", "Communication Systems", "VLSI"],
        EEE: ["Power Systems", "Electrical Machines", "Control Systems", "Digital Logic", "EMI"],
        ME: ["Thermodynamics", "Machine Design", "Manufacturing Tech", "Fluid Mechanics", "Heat Transfer"],
        CE: ["Surveying", "Structural Analysis", "Geotechnical Engg", "Hydraulics", "Concrete Tech"]
    };

    let counter = 0;
    for (const department of departments) {
        for (const year of yearLabels) {
            for (const semester of [1, 2, 3, 4, 5, 6, 7, 8]) {
                const sections = ["A", "B", "C"];
                for (const section of sections) {
                    for (let studentIndex = 1; studentIndex <= 18; studentIndex += 1) {
                        counter += 1;
                        const studentId = studentIds[(counter - 1) % studentIds.length];
                        const subjectList = subjectMap[department] || subjectMap.CSE;
                        for (let i = 0; i < subjectList.length; i += 1) {
                            const subjectName = subjectList[i];
                            const internal = 18 + ((counter + i + studentIndex) % 25);
                            const external = 28 + ((counter + i * 3 + studentIndex) % 38);
                            const shouldFail = (section === "A" && studentIndex > 16)
                                || (section === "B" && studentIndex > 13);
                            const total = shouldFail
                                ? Math.min(100, Math.max(22, internal + external - 38))
                                : Math.min(100, Math.max(48, internal + external));
                            const grade = getResultGrade(total);
                            const passStatus = derivePassStatus(total);
                            const backlogStatus = passStatus === "Pass" ? "None" : (i % 2 === 0 ? "Backlog" : "Arrear");
                            const publicationStatus = i === 0 && counter % 3 === 0 ? "Published" : "Draft";
                            db.prepare(`
                                INSERT INTO result_records (
                                    student_id, department, year, semester, section, academic_year,
                                    subject, subject_code, internal_marks, external_marks, total_marks,
                                    grade, grade_point, pass_status, backlog_status, result_status,
                                    publication_status, created_by, created_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                            `).run(
                                studentId,
                                department,
                                year,
                                semester,
                                section,
                                academicYear,
                                subjectName,
                                `${department}-${semester}-${String(i + 1).padStart(2, "0")}`,
                                internal,
                                external,
                                total,
                                grade,
                                getGradePoint(grade),
                                passStatus,
                                backlogStatus,
                                "Reviewed",
                                publicationStatus,
                                createdBy
                            );
                        }
                    }
                }
            }
        }
    }
}

const apiRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 240,
    message: "Too many requests. Please try again shortly."
});

app.use("/api", apiRateLimiter);


// Serve frontend files
app.use(express.static(path.join(__dirname)));


// ============================================================
// DATABASE INITIALIZATION
// ============================================================

function ensureStudentProfileColumns() {
    const tableInfo = db.prepare("PRAGMA table_info(students)").all();
    const existingColumns = new Set(tableInfo.map((column) => column.name));

    const requiredColumns = [
        ["dob", "TEXT"],
        ["gender", "TEXT"],
        ["parent_name", "TEXT"],
        ["parent_mobile", "TEXT"],
        ["parent_email", "TEXT"],
        ["address", "TEXT"],
        ["city", "TEXT"],
        ["district", "TEXT"],
        ["state", "TEXT"],
        ["pincode", "TEXT"],
        ["profile_photo", "TEXT"],
        ["linkedin_url", "TEXT"],
        ["github_url", "TEXT"],
        ["instagram_url", "TEXT"],
        ["other_link_url", "TEXT"],
        ["portfolio_url", "TEXT"]
    ];

    requiredColumns.forEach(([columnName, columnType]) => {
        if (!existingColumns.has(columnName)) {
            db.exec(`ALTER TABLE students ADD COLUMN ${columnName} ${columnType};`);
        }
    });
}

function ensureAuditLogColumns() {
    const tableInfo = db.prepare("PRAGMA table_info(audit_logs)").all();
    const existingColumns = new Set(tableInfo.map((column) => column.name));

    const requiredColumns = [
        ["entity_type", "TEXT"],
        ["entity_id", "INTEGER"],
        ["metadata", "TEXT"]
    ];

    requiredColumns.forEach(([columnName, columnType]) => {
        if (!existingColumns.has(columnName)) {
            db.exec(`ALTER TABLE audit_logs ADD COLUMN ${columnName} ${columnType};`);
        }
    });
}

function ensureColumn(tableName, columnName, columnType) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some((column) => column.name === columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
    }
}

function migrateLegacyModuleColumns() {
    const migrations = [
        ["notifications", "branch", "TEXT"],
        ["notifications", "year", "INTEGER"],
        ["notifications", "section", "TEXT"],
        ["departments", "code", "TEXT"],
        ["departments", "name", "TEXT"],
        ["academic_years", "name", "TEXT"],
        ["academic_years", "label", "TEXT"],
        ["academic_years", "starts_on", "TEXT"],
        ["academic_years", "ends_on", "TEXT"],
        ["academic_years", "is_active", "INTEGER DEFAULT 0"],
        ["documents", "student_id", "INTEGER"],
        ["documents", "title", "TEXT"],
        ["documents", "category", "TEXT"],
        ["documents", "file_path", "TEXT"],
        ["documents", "uploaded_by", "INTEGER"],
        ["documents", "created_at", "DATETIME"],
        ["documents", "visibility", "TEXT DEFAULT 'Private'"],
        ["leave_requests", "starts_on", "TEXT"],
        ["leave_requests", "ends_on", "TEXT"],
        ["leave_requests", "reviewer_remarks", "TEXT"],
        ["leave_requests", "reviewed_by", "INTEGER"],
        ["leave_requests", "reviewed_at", "DATETIME"],
        ["assignments", "deadline", "TEXT"],
        ["assignments", "attachment_path", "TEXT"],
        ["assignments", "assigned_by", "INTEGER"],
        ["assignment_submissions", "status", "TEXT DEFAULT 'Pending'"],
        ["buses", "route", "TEXT"],
        ["buses", "driver_name", "TEXT"],
        ["buses", "driver_mobile", "TEXT"],
        ["buses", "bus_fee", "REAL"],
        ["buses", "academic_year", "TEXT"],
        ["buses", "available", "INTEGER DEFAULT 1"],
        ["bus_stops", "arrival_time", "TEXT"],
        ["bus_stops", "sequence_number", "INTEGER"],
        ["student_bus_assignments", "payment_status", "TEXT DEFAULT 'Pending'"],
        ["student_bus_assignments", "created_at", "DATETIME"]
    ];

    migrations.forEach(([tableName, columnName, columnType]) => {
        ensureColumn(tableName, columnName, columnType);
    });

    db.exec(`
        UPDATE departments
        SET code = COALESCE(code, CASE name
            WHEN 'Computer Science and Engineering' THEN 'CSE'
            WHEN 'Electronics and Communication Engineering' THEN 'ECE'
            WHEN 'Electrical and Electronics Engineering' THEN 'EEE'
            WHEN 'Mechanical Engineering' THEN 'ME'
            WHEN 'Civil Engineering' THEN 'CE'
            ELSE UPPER(SUBSTR(name, 1, 3))
        END);

        UPDATE academic_years
        SET label = COALESCE(label, name),
            is_active = COALESCE(is_active, 0);

        UPDATE documents
        SET title = COALESCE(title, document_name),
            category = COALESCE(category, document_type),
            file_path = COALESCE(file_path, file_url),
            uploaded_by = COALESCE(uploaded_by, user_id),
            created_at = COALESCE(created_at, uploaded_at),
            student_id = COALESCE(
                student_id,
                (SELECT s.id FROM students s WHERE s.user_id = documents.user_id)
            ),
            visibility = COALESCE(visibility, 'Private');

        UPDATE leave_requests
        SET starts_on = COALESCE(starts_on, from_date),
            ends_on = COALESCE(ends_on, to_date),
            reviewer_remarks = COALESCE(reviewer_remarks, response);

        UPDATE assignments
        SET deadline = COALESCE(deadline, due_date),
            attachment_path = COALESCE(attachment_path, attachment_url),
            assigned_by = COALESCE(assigned_by, faculty_id);

        UPDATE buses
        SET route = COALESCE(route, route_name),
            available = CASE
                WHEN available IS NULL THEN CASE WHEN status = 'Active' THEN 1 ELSE 0 END
                ELSE available
            END;
    `);
}

try {

    const schemaPath =
        path.join(
            __dirname,
            "database",
            "schema.sql"
        );

    if (fs.existsSync(schemaPath)) {

        const schema =
            fs.readFileSync(
                schemaPath,
                "utf8"
            );

        db.exec(schema);

        console.log(
            "Database schema loaded successfully."
        );
    }

    ensureStudentProfileColumns();
    ensureAuditLogColumns();
    migrateLegacyModuleColumns();

} catch (error) {

    console.error(
        "Database schema error:",
        error
    );

}


// ============================================================
// EXTRA NOTIFICATION TABLE
// ============================================================

try {

    db.exec(`
        CREATE TABLE IF NOT EXISTS notification_reads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notification_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            read_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(notification_id, student_id),

            FOREIGN KEY(notification_id)
            REFERENCES notifications(id)
            ON DELETE CASCADE,

            FOREIGN KEY(student_id)
            REFERENCES students(id)
            ON DELETE CASCADE
        );
    `);

    console.log(
        "notification_reads table ready."
    );

} catch (error) {

    console.error(
        "Notification table error:",
        error
    );

}


// ============================================================
// FUTURE STUDENT-SPECIFIC NOTIFICATION TABLE
// ============================================================

try {

    db.exec(`
        CREATE TABLE IF NOT EXISTS notification_recipients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            notification_id INTEGER NOT NULL,

            student_id INTEGER NOT NULL,

            FOREIGN KEY(notification_id)
            REFERENCES notifications(id)
            ON DELETE CASCADE,

            FOREIGN KEY(student_id)
            REFERENCES students(id)
            ON DELETE CASCADE,

            UNIQUE(notification_id, student_id)
        );
    `);

} catch (error) {

    console.error(
        "Notification recipients table error:",
        error
    );

}


try {

    db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT UNIQUE NOT NULL,
            setting_value TEXT NOT NULL,
            description TEXT,
            updated_by INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
        );
    `);

    const defaultSettings = [
        ["demo_data_mode", "true", "Keep unofficial records clearly marked as sample data."],
        ["public_registration", "false", "Allow public self-registration without admin approval."],
        ["payment_gateway", "false", "Enable external payment processing."],
        ["registration_approval", "false", "Require admin approval before new registrations are activated."],
        ["email_notifications", "true", "Send email notifications for portal updates."]
    ];

    const insertDefaultSetting = db.prepare(`
        INSERT OR IGNORE INTO app_settings (setting_key, setting_value, description)
        VALUES (?, ?, ?)
    `);

    defaultSettings.forEach(([key, value, description]) => {
        insertDefaultSetting.run(key, value, description);
    });

    console.log("app_settings table ready.");

    ensureResultSeedData();
    ensureDemoAccounts();

} catch (error) {

    console.error("App settings table error:", error);

}


try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_otps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            otp_hash TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);
    console.log("password_reset_otps table ready.");
} catch (error) {
    console.error("Password reset table error:", error);
}

function getMailTransport() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
        return null;
    }

    return nodemailer.createTransport({
        host,
        port,
        secure: process.env.SMTP_SECURE === "true",
        auth: { user, pass }
    });
}


function createPasswordResetOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}


// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function ensureDemoAccounts() {
    try {
        const customAdminUser = db.prepare(`
            SELECT id
            FROM users
            WHERE username = ?
        `).get(ALLOWED_ADMIN_USERNAME);

        if (!customAdminUser) {
            const customAdminPasswordHash = await bcrypt.hash(ALLOWED_ADMIN_PASSWORD, 10);
            db.prepare(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'admin')
            `).run(ALLOWED_ADMIN_USERNAME, customAdminPasswordHash);
            console.log(`Custom admin account created: ${ALLOWED_ADMIN_USERNAME} / ${ALLOWED_ADMIN_PASSWORD}`);
        }

        const defaultAdminUser = db.prepare(`
            SELECT id
            FROM users
            WHERE username = ?
        `).get("admin");

        if (defaultAdminUser) {
            db.prepare(`
                DELETE FROM users
                WHERE username = ?
            `).run("admin");
            console.log("Default demo admin removed to restrict access to the custom admin account.");
        }

        const studentUser = db.prepare(`
            SELECT u.id, s.id AS student_record_id, s.student_id
            FROM users u
            LEFT JOIN students s ON s.user_id = u.id
            WHERE u.username = ?
        `).get("student");

        if (!studentUser) {
            const studentPasswordHash = await bcrypt.hash("student123", 10);
            const userResult = db.prepare(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'student')
            `).run("student", studentPasswordHash);

            db.prepare(`
                INSERT INTO students (
                    user_id,
                    student_id,
                    roll_number,
                    full_name,
                    email,
                    mobile,
                    department,
                    year,
                    section,
                    academic_year,
                    fee_category,
                    parent_name,
                    parent_mobile,
                    parent_email,
                    address,
                    city,
                    district,
                    state,
                    pincode
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userResult.lastInsertRowid,
                "STU-1001",
                "STU-1001",
                "Demo Student",
                "student@khit.edu.in",
                "9876543210",
                "Computer Science",
                2,
                "A",
                "2026-27",
                "Management",
                "Demo Parent",
                "9876500001",
                "parent@khit.edu.in",
                "123 Demo Street",
                "Hyderabad",
                "Rangareddy",
                "Telangana",
                "500001"
            );

            console.log("Demo student account created: student / student123");
        } else if (!studentUser.student_record_id) {
            db.prepare(`
                INSERT INTO students (
                    user_id,
                    student_id,
                    roll_number,
                    full_name,
                    email,
                    mobile,
                    department,
                    year,
                    section,
                    academic_year,
                    fee_category,
                    parent_name,
                    parent_mobile,
                    parent_email,
                    address,
                    city,
                    district,
                    state,
                    pincode
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                studentUser.id,
                "STU-1001",
                "STU-1001",
                "Demo Student",
                "student@khit.edu.in",
                "9876543210",
                "Computer Science",
                2,
                "A",
                "2026-27",
                "Management",
                "Demo Parent",
                "9876500001",
                "parent@khit.edu.in",
                "123 Demo Street",
                "Hyderabad",
                "Rangareddy",
                "Telangana",
                "500001"
            );
        }

        const facultyUser = db.prepare(`
            SELECT u.id, f.id AS faculty_record_id
            FROM users u
            LEFT JOIN faculty f ON f.user_id = u.id
            WHERE u.username = ?
        `).get("faculty");

        if (!facultyUser) {
            const facultyPasswordHash = await bcrypt.hash("faculty123", 10);
            const userResult = db.prepare(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'faculty')
            `).run("faculty", facultyPasswordHash);

            db.prepare(`
                INSERT INTO faculty (faculty_id, full_name, department, designation, email, mobile, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                "FAC-1001",
                "Demo Faculty",
                "Computer Science",
                "Assistant Professor",
                "faculty@khit.edu.in",
                "9988776655",
                userResult.lastInsertRowid
            );

            console.log("Demo faculty account created: faculty / faculty123");
        }

        const demoStudent = db.prepare(`
            SELECT id
            FROM students
            WHERE student_id = ?
        `).get("STU-1001");

        if (demoStudent) {
            const feeCount = db.prepare(`
                SELECT COUNT(*) AS count
                FROM fees
                WHERE student_id = ?
            `).get(demoStudent.id).count;

            if (feeCount === 0) {
                db.prepare(`
                    INSERT INTO fees (student_id, academic_year, fee_year, total_amount, paid_amount, pending_amount, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(demoStudent.id, "2026-27", 2, 45000, 28000, 17000, "Partial");
            }

            const subjectCount = db.prepare(`SELECT COUNT(*) AS count FROM subjects`).get().count;
            if (subjectCount === 0) {
                db.prepare(`
                    INSERT INTO subjects (name, code, department, year, semester, section)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run("Data Structures", "DS-101", "Computer Science", 2, 3, "A");
                db.prepare(`
                    INSERT INTO subjects (name, code, department, year, semester, section)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run("Database Management Systems", "DBMS-201", "Computer Science", 2, 3, "A");
                db.prepare(`
                    INSERT INTO subjects (name, code, department, year, semester, section)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run("Operating Systems", "OS-301", "Computer Science", 2, 3, "A");
            }

            const attendanceCount = db.prepare(`
                SELECT COUNT(*) AS count
                FROM attendance
                WHERE student_id = ?
            `).get(demoStudent.id).count;

            if (attendanceCount === 0) {
                const subjects = db.prepare(`SELECT id, name FROM subjects ORDER BY id LIMIT 3`).all();
                const dates = ["2026-09-02", "2026-09-04", "2026-09-06", "2026-09-09", "2026-09-11"];
                const statuses = ["Present", "Present", "Absent", "Present", "Leave"];

                for (let idx = 0; idx < dates.length; idx += 1) {
                    const subject = subjects[idx % subjects.length];
                    db.prepare(`
                        INSERT INTO attendance (student_id, subject, attendance_date, status)
                        VALUES (?, ?, ?, ?)
                    `).run(demoStudent.id, subject.name, dates[idx], statuses[idx]);
                }
            }

            const marksCount = db.prepare(`
                SELECT COUNT(*) AS count
                FROM marks
                WHERE student_id = ?
            `).get(demoStudent.id).count;

            if (marksCount === 0) {
                const subjects = db.prepare(`SELECT id, name FROM subjects ORDER BY id LIMIT 3`).all();
                const sampleMarks = [
                    [subjects[0].id, "Midterm", 84, 100],
                    [subjects[1].id, "Quiz", 92, 100],
                    [subjects[2].id, "Assignment", 88, 100]
                ];

                sampleMarks.forEach(([subjectId, examType, marks, maxMarks]) => {
                    db.prepare(`
                        INSERT INTO marks (student_id, subject_id, exam_type, marks, max_marks, exam_date)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).run(demoStudent.id, subjectId, examType, marks, maxMarks, "2026-09-15");
                });
            }

            const notificationCount = db.prepare(`SELECT COUNT(*) AS count FROM notifications`).get().count;
            if (notificationCount === 0) {
                db.prepare(`
                    INSERT INTO notifications (title, message, audience, is_read, created_at)
                    VALUES (?, ?, ?, ?, datetime('now'))
                `).run("Welcome to KHIT Family", "Your student portal is ready. Please review your profile and fee updates.", "All", 0);
                db.prepare(`
                    INSERT INTO notifications (title, message, audience, is_read, created_at)
                    VALUES (?, ?, ?, ?, datetime('now'))
                `).run("Mid-Semester Review", "Parents can now review attendance and marks from the dashboard.", "Parents", 0);
            }
        }

        await ensureDemoData();
    } catch (error) {
        console.error("Demo account setup error:", error);
    }
}

async function ensureDemoData() {
    const departments = [
        ["CSE", "Computer Science and Engineering"],
        ["ECE", "Electronics and Communication Engineering"],
        ["EEE", "Electrical and Electronics Engineering"],
        ["ME", "Mechanical Engineering"],
        ["CE", "Civil Engineering"]
    ];
    const insertDepartment = db.prepare(`
        INSERT OR IGNORE INTO departments (code, name) VALUES (?, ?)
    `);
    departments.forEach((department) => insertDepartment.run(...department));

    db.prepare(`
        INSERT OR IGNORE INTO academic_years (name, label, starts_on, ends_on, is_active)
        VALUES ('2026-27', '2026-27', '2026-07-01', '2027-06-30', 1)
    `).run();

    const studentNames = [
        "Aarav Mehta", "Ananya Rao", "Arjun Nair", "Diya Reddy", "Ishaan Varma",
        "Kavya Menon", "Manish Patel", "Nisha Iyer", "Rohan Das", "Saanvi Shah",
        "Tanmay Joshi", "Veda Krishnan", "Yash Kulkarni", "Zoya Khan", "Aditya Sen",
        "Bhavana Rao", "Charan Dev", "Harini Goud", "Kiran Babu", "Meera Paul"
    ];
    const departmentCodes = ["CSE", "ECE", "EEE", "ME", "CE"];
    const insertUser = db.prepare(`
        INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, 'student')
    `);
    const insertStudent = db.prepare(`
        INSERT OR IGNORE INTO students
            (user_id, student_id, roll_number, full_name, email, mobile, department, year,
             section, academic_year, fee_category, parent_name, parent_mobile, parent_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-27', 'Management', ?, ?, ?)
    `);
    const studentPasswordHash = await bcrypt.hash("student123", 10);

    studentNames.forEach((fullName, index) => {
        const studentCode = `STU-${1002 + index}`;
        insertUser.run(`demo_${studentCode.toLowerCase()}`, studentPasswordHash);
        const user = db.prepare("SELECT id FROM users WHERE username = ?").get(`demo_${studentCode.toLowerCase()}`);
        const department = departmentCodes[index % departmentCodes.length];
        const year = (index % 4) + 1;
        insertStudent.run(
            user.id,
            studentCode,
            studentCode,
            fullName,
            `${studentCode.toLowerCase()}@demo.khit.edu.in`,
            `987650${String(1000 + index).slice(-4)}`,
            department,
            year,
            index % 2 === 0 ? "A" : "B",
            `Demo Parent ${index + 1}`,
            `986650${String(1000 + index).slice(-4)}`,
            `parent${index + 1}@demo.khit.edu.in`
        );
    });

    const facultyNames = [
        "Dr. Neha Kapoor", "Prof. Vikram Rao", "Dr. Meena Iyer", "Prof. Suresh Babu",
        "Dr. Ritu Sharma", "Prof. Karthik Nair", "Dr. Asha Menon", "Prof. Rahul Das",
        "Dr. Pooja Sen", "Prof. Naveen Kumar"
    ];
    const insertFacultyUser = db.prepare(`
        INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, 'faculty')
    `);
    const insertFaculty = db.prepare(`
        INSERT OR IGNORE INTO faculty
            (user_id, faculty_id, full_name, department, designation, email, mobile)
        VALUES (?, ?, ?, ?, 'Assistant Professor', ?, ?)
    `);
    const facultyPasswordHash = await bcrypt.hash("faculty123", 10);
    facultyNames.forEach((fullName, index) => {
        const facultyCode = `FAC-${1002 + index}`;
        const username = `demo_${facultyCode.toLowerCase()}`;
        insertFacultyUser.run(username, facultyPasswordHash);
        const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        insertFaculty.run(
            user.id,
            facultyCode,
            fullName,
            departmentCodes[index % departmentCodes.length],
            `${username}@demo.khit.edu.in`,
            `998870${String(1000 + index).slice(-4)}`
        );
    });

    const subjectRows = [
        ["Data Structures", "CSE-201", "CSE", 2], ["Database Systems", "CSE-202", "CSE", 2],
        ["Digital Electronics", "ECE-201", "ECE", 2], ["Circuit Theory", "EEE-201", "EEE", 2],
        ["Engineering Mechanics", "ME-201", "ME", 2], ["Surveying", "CE-201", "CE", 2]
    ];
    const insertSubject = db.prepare(`
        INSERT INTO subjects (name, code, department, year, semester, section)
        SELECT ?, ?, ?, ?, 3, 'A'
        WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE code = ?)
    `);
    subjectRows.forEach((subject) => insertSubject.run(...subject, subject[1]));

    const students = db.prepare("SELECT id, student_id, department, year, section FROM students WHERE student_id LIKE 'STU-%' ORDER BY id").all();
    const subjects = db.prepare("SELECT id, name FROM subjects ORDER BY id").all();
    const faculty = db.prepare("SELECT id, user_id FROM faculty ORDER BY id").all();
    const insertFee = db.prepare(`
        INSERT INTO fees (student_id, academic_year, fee_year, total_amount, paid_amount, pending_amount, status)
        SELECT ?, '2026-27', ?, 45000, 30000, 15000, 'Partial'
        WHERE NOT EXISTS (SELECT 1 FROM fees WHERE student_id = ? AND academic_year = '2026-27' AND fee_year = ?)
    `);
    const insertAttendance = db.prepare(`
        INSERT INTO attendance (student_id, subject, attendance_date, status)
        SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM attendance WHERE student_id = ? AND subject = ? AND attendance_date = ?)
    `);
    const insertMark = db.prepare(`
        INSERT INTO marks (student_id, subject_id, exam_type, marks, max_marks, exam_date)
        SELECT ?, ?, 'Midterm', ?, 100, '2026-09-15'
        WHERE NOT EXISTS (SELECT 1 FROM marks WHERE student_id = ? AND subject_id = ? AND exam_type = 'Midterm')
    `);
    students.forEach((student, index) => {
        insertFee.run(student.id, student.year, student.id, student.year);
        const subject = subjects[index % subjects.length];
        const attendanceStatus = index % 5 === 0 ? "Absent" : "Present";
        insertAttendance.run(student.id, subject.name, "2026-09-10", attendanceStatus, student.id, subject.name, "2026-09-10");
        const mark = 72 + (index % 24);
        insertMark.run(student.id, subject.id, mark, student.id, subject.id);
    });

    db.prepare(`
        INSERT INTO events (title, description, event_date, venue)
        SELECT 'Demo Tech Symposium', 'Fictional sample event for portal testing.', '2026-11-12', 'Main Auditorium'
        WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Demo Tech Symposium')
    `).run();
    db.prepare(`
        INSERT INTO study_materials (title, description, material_type, file_url, subject, department, year, section)
        SELECT 'Data Structures Unit 1', 'Fictional demo study material.', 'Document', NULL, name, 'CSE', 2, 'A'
        FROM subjects
        WHERE code = 'CSE-201'
          AND NOT EXISTS (SELECT 1 FROM study_materials WHERE title = 'Data Structures Unit 1')
    `).run();

    const assignmentSubject = db.prepare("SELECT id FROM subjects WHERE code = 'CSE-201'").get();
    if (assignmentSubject) {
        db.prepare(`
            INSERT INTO assignments (subject_id, title, description, deadline, assigned_by)
            SELECT ?, 'Demo Linked List Assignment', 'Fictional sample assignment.', '2026-10-15', ?
            WHERE NOT EXISTS (SELECT 1 FROM assignments WHERE title = 'Demo Linked List Assignment')
        `).run(assignmentSubject.id, faculty[0] ? faculty[0].user_id : null);
    }

    db.exec(`
        DELETE FROM events WHERE title = 'Demo Tech Symposium'
            AND id NOT IN (SELECT MIN(id) FROM events WHERE title = 'Demo Tech Symposium');
        DELETE FROM study_materials WHERE title = 'Data Structures Unit 1'
            AND id NOT IN (SELECT MIN(id) FROM study_materials WHERE title = 'Data Structures Unit 1');
        DELETE FROM assignments WHERE title = 'Demo Linked List Assignment'
            AND id NOT IN (SELECT MIN(id) FROM assignments WHERE title = 'Demo Linked List Assignment');
        DELETE FROM fees
            WHERE academic_year = '2026-27' AND total_amount = 45000
              AND paid_amount = 30000 AND pending_amount = 15000
              AND id NOT IN (
                  SELECT MIN(id) FROM fees
                  WHERE academic_year = '2026-27' AND total_amount = 45000
                    AND paid_amount = 30000 AND pending_amount = 15000
                  GROUP BY student_id, fee_year
              );
        DELETE FROM attendance
            WHERE attendance_date = '2026-09-10'
              AND id NOT IN (
                  SELECT MIN(id) FROM attendance
                  WHERE attendance_date = '2026-09-10'
                  GROUP BY student_id, subject
              );
        DELETE FROM marks
            WHERE exam_type = 'Midterm' AND exam_date = '2026-09-15'
              AND id NOT IN (
                  SELECT MIN(id) FROM marks
                  WHERE exam_type = 'Midterm' AND exam_date = '2026-09-15'
                  GROUP BY student_id, subject_id
              );
    `);

    const bus = db.prepare(`
        INSERT OR IGNORE INTO buses (bus_number, route, driver_name, driver_mobile, bus_fee, academic_year)
        VALUES ('DEMO-01', 'Central Campus Loop', 'Demo Driver', '9000000001', 12000, '2026-27')
    `).run();
    const busRow = db.prepare("SELECT id FROM buses WHERE bus_number = 'DEMO-01'").get();
    db.prepare(`
        INSERT OR IGNORE INTO bus_stops (bus_id, stop_name, pickup_time, arrival_time, sequence_number)
        VALUES (?, 'Demo City Center', '07:30', '08:15', 1)
    `).run(busRow.id);
    const stop = db.prepare("SELECT id FROM bus_stops WHERE bus_id = ? ORDER BY id LIMIT 1").get(busRow.id);
    if (students[0] && stop) {
        db.prepare(`
            INSERT OR IGNORE INTO student_bus_assignments (student_id, bus_id, stop_id, academic_year, payment_status)
            VALUES (?, ?, ?, '2026-27', 'Pending')
        `).run(students[0].id, busRow.id, stop.id);
    }
}

function generateToken(user) {

    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role
        },
        JWT_SECRET,
        {
            expiresIn: "1d"
        }
    );

}


function getTokenFromRequest(req) {

    const auth =
        req.headers.authorization;

    if (!auth) {
        return null;
    }

    if (!auth.startsWith("Bearer ")) {
        return null;
    }

    return auth.substring(7);

}

function normalizeOptionalHttpUrl(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) return null;
    if (rawValue.length > 2048) return null;

    try {
        const parsed = new URL(rawValue);
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
            return null;
        }
        return parsed.toString();
    } catch (error) {
        return null;
    }
}

function validateOptionalProfileLinks(payload) {
    const fields = ["linkedin_url", "github_url", "instagram_url", "other_link_url", "portfolio_url"];
    const links = {};

    for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
        const rawValue = String(payload[field] || "").trim();
        if (!rawValue) {
            links[field] = null;
            continue;
        }

        const normalizedValue = normalizeOptionalHttpUrl(rawValue);
        if (!normalizedValue) {
            return { error: `${field} must be a valid HTTP or HTTPS URL` };
        }
        links[field] = normalizedValue;
    }

    return { links };
}


// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

function authenticateToken(req, res, next) {

    const token =
        getTokenFromRequest(req);

    if (!token) {

        return res.status(401).json({
            status: "error",
            message: "Authentication token required"
        });

    }

    try {

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            status: "error",
            message: "Invalid or expired token"
        });

    }

}


// ============================================================
// STUDENT AUTH MIDDLEWARE
// ============================================================

function requireStudent(req, res, next) {

    if (
        !req.user ||
        req.user.role !== "student"
    ) {

        return res.status(403).json({
            status: "error",
            message: "Student access required"
        });

    }

    next();

}


// ============================================================
// ADMIN AUTH MIDDLEWARE
// ============================================================

function requireAdmin(req, res, next) {

    if (!req.user) {

        return res.status(401).json({
            status: "error",
            message: "Authentication required"
        });

    }

    if (
        req.user.role !== "admin" &&
        req.user.role !== "superadmin"
    ) {

        return res.status(403).json({
            status: "error",
            message: "Admin access required"
        });

    }

    next();

}


// ============================================================
// PARENT AUTH MIDDLEWARE
// ============================================================

function requireParent(req, res, next) {

    if (!req.user) {

        return res.status(401).json({
            status: "error",
            message: "Authentication required"
        });

    }

    if (req.user.role !== "parent") {

        return res.status(403).json({
            status: "error",
            message: "Parent access required"
        });

    }

    next();

}

function requireFaculty(req, res, next) {

    if (!req.user) {
        return res.status(401).json({
            status: "error",
            message: "Authentication required"
        });
    }

    if (req.user.role !== "faculty") {
        return res.status(403).json({
            status: "error",
            message: "Faculty access required"
        });
    }

    next();
}


// ============================================================
// ADMIN FILE UPLOADS
// ============================================================

app.post(
    "/api/admin/uploads",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        upload.single("file")(req, res, error => {

            if (error) {
                return res.status(400).json({
                    status: "error",
                    message: error.code === "LIMIT_FILE_SIZE"
                        ? "File size must be 10 MB or less"
                        : "Unsupported or invalid upload"
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    status: "error",
                    message: "A file is required"
                });
            }

            const fileUrl = `/uploads/${req.file.filename}`;

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, metadata)
                VALUES (?, ?, ?, ?)
            `).run(
                req.user.id,
                "UPLOAD",
                "file",
                JSON.stringify({
                    originalName: req.file.originalname,
                    fileUrl,
                    size: req.file.size,
                    mimeType: req.file.mimetype
                })
            );

            return res.status(201).json({
                status: "success",
                message: "File uploaded successfully",
                file: {
                    original_name: req.file.originalname,
                    file_name: req.file.filename,
                    file_url: fileUrl,
                    size: req.file.size,
                    mime_type: req.file.mimetype
                }
            });
        });
    }
);

app.get(
    "/api/admin/documents",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const where = search
                ? "WHERE d.title LIKE ? OR d.category LIKE ?"
                : "";
            const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

            const documents = db.prepare(`
                SELECT
                    d.*,
                    u.username,
                    d.title AS document_name,
                    d.category AS document_type,
                    d.file_path AS file_url,
                    d.created_at AS uploaded_at
                FROM documents d
                LEFT JOIN users u ON u.id = d.uploaded_by
                ${where}
                ORDER BY d.created_at DESC, d.id DESC
                LIMIT ? OFFSET ?
            `).all(...searchParams, limit, offset);
            const total = db.prepare(`
                SELECT COUNT(*) AS total FROM documents d ${where}
            `).get(...searchParams).total;

            return res.json({
                status: "success",
                documents,
                pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
            });

        } catch (error) {

            console.error("Admin documents load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/documents",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        upload.single("file")(req, res, error => {

            if (error) {
                return res.status(400).json({
                    status: "error",
                    message: error.code === "LIMIT_FILE_SIZE"
                        ? "File size must be 10 MB or less"
                        : "Unsupported or invalid upload"
                });
            }

            const documentName = String(req.body.document_name || req.body.title || "").trim();
            const documentType = String(req.body.document_type || req.body.category || "Other").trim();
            const requestedStudentId = req.body.student_id ? Number(req.body.student_id) : null;
            const requestedUserId = req.body.user_id ? Number(req.body.user_id) : null;
            const studentId = requestedStudentId || (requestedUserId
                ? (db.prepare("SELECT id FROM students WHERE user_id = ?").get(requestedUserId) || {}).id
                : null);
            const visibility = String(req.body.visibility || "Private").trim() === "Public"
                ? "Public"
                : "Private";

            if (!documentName || !req.file) {
                return res.status(400).json({
                    status: "error",
                    message: "Document name and file are required"
                });
            }

            if (studentId) {
                const student = db.prepare("SELECT id FROM students WHERE id = ?").get(studentId);
                if (!student) {
                    fs.unlinkSync(req.file.path);
                    return res.status(404).json({
                        status: "error",
                        message: "Target student not found"
                    });
                }
            }

            try {

                const fileUrl = `/uploads/${req.file.filename}`;
                const result = db.prepare(`
                    INSERT INTO documents
                        (student_id, title, category, file_path, uploaded_by, visibility, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `).run(studentId, documentName, documentType, fileUrl, req.user.id, visibility);

                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    req.user.id,
                    "UPLOAD",
                    "document",
                    result.lastInsertRowid,
                    JSON.stringify({ documentName, documentType, studentId, visibility, fileUrl })
                );

                return res.status(201).json({
                    status: "success",
                    message: "Document uploaded",
                    document_id: result.lastInsertRowid,
                    file_url: fileUrl
                });

            } catch (databaseError) {
                fs.unlinkSync(req.file.path);
                console.error("Admin document save error:", databaseError);
                return res.status(500).json({
                    status: "error",
                    message: databaseError.message
                });
            }
        });
    }
);

app.delete(
    "/api/admin/documents/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const documentId = Number(req.params.id);
            const document = db.prepare(`
                SELECT file_path
                FROM documents
                WHERE id = ?
            `).get(documentId);

            if (!document) {
                return res.status(404).json({ status: "error", message: "Document not found" });
            }

            const result = db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
            if (result.changes && document.file_path) {
                const filePath = path.join(__dirname, document.file_path.replace(/^\/+/, ""));
                if (filePath.startsWith(uploadDirectory) && fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            return res.json({ status: "success", message: "Document deleted" });
        } catch (error) {
            console.error("Admin document delete error:", error);
            return res.status(500).json({ status: "error", message: "Unable to delete document" });
        }
    }
);

// ============================================================
// APP SETTINGS
// ============================================================

app.get(
    "/api/admin/settings",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const rows = db.prepare(`
                SELECT setting_key, setting_value, description, updated_at
                FROM app_settings
                ORDER BY setting_key ASC
            `).all();

            const settings = {};
            rows.forEach((row) => {
                const value = row.setting_value;
                settings[row.setting_key] = value === "true" ? true : value === "false" ? false : value;
            });

            return res.json({
                status: "success",
                settings
            });

        } catch (error) {
            console.error("Admin settings load error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.put(
    "/api/admin/settings",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const updates = req.body || {};
            if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
                return res.status(400).json({
                    status: "error",
                    message: "Settings payload must be an object"
                });
            }

            const allowedKeys = new Set([
                "demo_data_mode",
                "public_registration",
                "payment_gateway",
                "registration_approval",
                "email_notifications"
            ]);

            const rowsToUpdate = [];
            Object.entries(updates).forEach(([key, value]) => {
                if (!allowedKeys.has(key)) {
                    return;
                }

                const normalizedValue = value === true || value === "true" ? "true" : "false";
                rowsToUpdate.push({ key, value: normalizedValue });
            });

            if (rowsToUpdate.length === 0) {
                return res.status(400).json({
                    status: "error",
                    message: "No valid settings provided"
                });
            }

            const stmt = db.prepare(`
                INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_by = excluded.updated_by,
                    updated_at = CURRENT_TIMESTAMP
            `);

            rowsToUpdate.forEach(({ key, value }) => {
                stmt.run(key, value, req.user.id);
            });

            const updatedSettings = db.prepare(`
                SELECT setting_key, setting_value
                FROM app_settings
                WHERE setting_key IN (${rowsToUpdate.map(() => "?").join(", ")})
            `).all(...rowsToUpdate.map(({ key }) => key));

            const responseSettings = {};
            updatedSettings.forEach((row) => {
                responseSettings[row.setting_key] = row.setting_value === "true";
            });

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, metadata)
                VALUES (?, ?, ?, ?)
            `).run(
                req.user.id,
                "UPDATE_SETTINGS",
                "app_settings",
                JSON.stringify({ updates: responseSettings })
            );

            return res.json({
                status: "success",
                message: "Settings updated successfully",
                settings: responseSettings
            });

        } catch (error) {
            console.error("Admin settings update error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);


// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
    res.redirect("/index.html");
});


// ============================================================
// SERVER STATUS
// ============================================================

app.get("/api/status", (req, res) => {

    res.json({
        status: "success",
        message: "KHIT Family Portal API is running",
        server: "online",
        port: PORT
    });

});

app.get("/api/demo-credentials", async (req, res) => {
    try {
        await ensureDemoAccounts();

        return res.json({
            status: "success",
            demoAccounts: {
                admin: {
                    username: ALLOWED_ADMIN_USERNAME,
                    role: "admin"
                },
                faculty: {
                    username: "faculty",
                    password: "faculty123",
                    role: "faculty"
                },
                student: {
                    username: "student",
                    password: "student123",
                    role: "student",
                    student_id: "STU-1001"
                },
                parent: {
                    student_id: "STU-1001",
                    parent_mobile: "9876500001",
                    parent_email: "parent@khit.edu.in"
                }
            }
        });
    } catch (error) {
        console.error("Demo credentials error:", error);
        return res.status(500).json({
            status: "error",
            message: "Unable to fetch demo credentials"
        });
    }
});


// ============================================================
// GENERIC LOGIN
// ============================================================

app.post("/api/password-reset/request", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const transport = getMailTransport();

        if (!username || !email) {
            return res.status(400).json({
                status: "error",
                message: "Username and registered email are required"
            });
        }

        if (!transport) {
            return res.status(503).json({
                status: "error",
                message: "Password reset email is not configured yet"
            });
        }

        const user = db.prepare(`
            SELECT u.id, u.username, s.email, s.full_name
            FROM users u
            JOIN students s ON s.user_id = u.id
            WHERE u.username = ? AND u.role = 'student' AND lower(s.email) = ?
        `).get(username, email);

        if (!user) {
            return res.status(400).json({
                status: "error",
                message: "Username and registered email do not match"
            });
        }

        const otp = createPasswordResetOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        db.prepare(`
            UPDATE password_reset_otps
            SET used_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND used_at IS NULL
        `).run(user.id);

        db.prepare(`
            INSERT INTO password_reset_otps (user_id, otp_hash, expires_at)
            VALUES (?, ?, ?)
        `).run(user.id, otpHash, expiresAt);

        await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: user.email,
            subject: "KHIT Family password reset OTP",
            text: `Hello ${user.full_name || user.username},\n\nYour KHIT Family password reset OTP is ${otp}. It expires in 10 minutes.\n\nIf you did not request this, ignore this email.`
        });

        return res.json({
            status: "success",
            message: "OTP sent to your registered email"
        });
    } catch (error) {
        console.error("Password reset request error:", error);
        return res.status(500).json({
            status: "error",
            message: "Unable to send password reset OTP"
        });
    }
});


app.post("/api/password-reset/confirm", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const otp = String(req.body.otp || "").trim();
        const newPassword = String(req.body.newPassword || "");

        if (!username || !email || !otp || newPassword.length < 8) {
            return res.status(400).json({
                status: "error",
                message: "Username, email, OTP, and an 8-character password are required"
            });
        }

        const user = db.prepare(`
            SELECT u.id
            FROM users u
            JOIN students s ON s.user_id = u.id
            WHERE u.username = ? AND u.role = 'student' AND lower(s.email) = ?
        `).get(username, email);

        const reset = user && db.prepare(`
            SELECT *
            FROM password_reset_otps
            WHERE user_id = ? AND used_at IS NULL
            ORDER BY id DESC
            LIMIT 1
        `).get(user.id);

        if (!reset || new Date(reset.expires_at).getTime() < Date.now()) {
            return res.status(400).json({
                status: "error",
                message: "OTP is invalid or expired"
            });
        }

        if (!(await bcrypt.compare(otp, reset.otp_hash))) {
            return res.status(400).json({
                status: "error",
                message: "OTP is invalid or expired"
            });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        db.prepare("UPDATE users SET password = ? WHERE id = ?").run(passwordHash, user.id);
        db.prepare("UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(reset.id);

        return res.json({
            status: "success",
            message: "Password reset successful. You can login now."
        });
    } catch (error) {
        console.error("Password reset confirmation error:", error);
        return res.status(500).json({
            status: "error",
            message: "Unable to reset password"
        });
    }
});


app.post("/api/admin-password-reset/request", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const configuredEmail = String(process.env.ADMIN_RESET_EMAIL || "").trim().toLowerCase();
        const transport = getMailTransport();

        if (!username || !email) {
            return res.status(400).json({ status: "error", message: "Admin username and reset email are required" });
        }

        if (!transport || !configuredEmail) {
            return res.status(503).json({ status: "error", message: "Admin password reset email is not configured yet" });
        }

        const user = db.prepare(`
            SELECT id, username
            FROM users
            WHERE username = ? AND role IN ('admin', 'superadmin')
        `).get(username);

        if (!user || email !== configuredEmail) {
            return res.status(400).json({ status: "error", message: "Admin username and reset email do not match" });
        }

        const otp = createPasswordResetOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        db.prepare(`
            UPDATE password_reset_otps
            SET used_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND used_at IS NULL
        `).run(user.id);
        db.prepare(`
            INSERT INTO password_reset_otps (user_id, otp_hash, expires_at)
            VALUES (?, ?, ?)
        `).run(user.id, otpHash, expiresAt);

        await transport.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: configuredEmail,
            subject: "KHIT Family admin password reset OTP",
            text: `Your KHIT Family admin password reset OTP is ${otp}. It expires in 10 minutes.`
        });

        return res.json({ status: "success", message: "OTP sent to the configured admin email" });
    } catch (error) {
        console.error("Admin password reset request error:", error);
        return res.status(500).json({ status: "error", message: "Unable to send admin password reset OTP" });
    }
});


app.post("/api/admin-password-reset/confirm", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const otp = String(req.body.otp || "").trim();
        const newPassword = String(req.body.newPassword || "");
        const configuredEmail = String(process.env.ADMIN_RESET_EMAIL || "").trim().toLowerCase();

        if (!username || email !== configuredEmail || !otp || newPassword.length < 8) {
            return res.status(400).json({ status: "error", message: "Valid admin email, OTP, and an 8-character password are required" });
        }

        const user = db.prepare(`
            SELECT id
            FROM users
            WHERE username = ? AND role IN ('admin', 'superadmin')
        `).get(username);
        const reset = user && db.prepare(`
            SELECT * FROM password_reset_otps
            WHERE user_id = ? AND used_at IS NULL
            ORDER BY id DESC LIMIT 1
        `).get(user.id);

        if (!reset || new Date(reset.expires_at).getTime() < Date.now() || !(await bcrypt.compare(otp, reset.otp_hash))) {
            return res.status(400).json({ status: "error", message: "OTP is invalid or expired" });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        db.prepare("UPDATE users SET password = ? WHERE id = ?").run(passwordHash, user.id);
        db.prepare("UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(reset.id);

        return res.json({ status: "success", message: "Admin password reset successful. You can login now." });
    } catch (error) {
        console.error("Admin password reset confirmation error:", error);
        return res.status(500).json({ status: "error", message: "Unable to reset admin password" });
    }
});

app.post(
    "/api/login",
    async (req, res) => {
        try {
            const {
                username,
                password,
                role,
                student_id: studentId,
                parent_mobile: parentMobile,
                parent_email: parentEmail
            } = req.body;

            const requestedRole = String(role || "").trim().toLowerCase();

            if (requestedRole === "parent" || studentId) {
                const normalizedStudentId = String(studentId || "").trim();
                const normalizedMobile = parentMobile ? String(parentMobile).trim() : "";
                const normalizedEmail = parentEmail ? String(parentEmail).trim() : "";

                if (!normalizedStudentId || (!normalizedMobile && !normalizedEmail)) {
                    return res.status(400).json({
                        status: "error",
                        message: "Student ID and parent mobile or email are required"
                    });
                }

                const student = db.prepare(`
                    SELECT *
                    FROM students
                    WHERE student_id = ?
                      AND (
                        parent_mobile = ? OR parent_email = ?
                      )
                `).get(
                    normalizedStudentId,
                    normalizedMobile || null,
                    normalizedEmail || null
                );

                if (!student) {
                    return res.status(401).json({
                        status: "error",
                        message: "Parent credentials do not match any student record"
                    });
                }

                const token = jwt.sign(
                    {
                        id: student.user_id,
                        role: "parent",
                        parent_name: student.parent_name,
                        student_id: student.student_id
                    },
                    JWT_SECRET,
                    { expiresIn: "1d" }
                );

                return res.json({
                    status: "success",
                    message: "Parent login successful",
                    token,
                    user: {
                        id: student.user_id,
                        username: student.student_id,
                        role: "parent"
                    },
                    student: {
                        id: student.id,
                        student_id: student.student_id,
                        full_name: student.full_name,
                        department: student.department,
                        year: student.year,
                        section: student.section,
                        parent_name: student.parent_name
                    }
                });
            }

            if (!username || !password) {
                return res.status(400).json({
                    status: "error",
                    message: "Username and password are required"
                });
            }

            if (requestedRole === "admin" || requestedRole === "superadmin") {
                if (username !== ALLOWED_ADMIN_USERNAME) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                const user = db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role IN ('admin', 'superadmin')
                `).get(username);

                if (!user) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                const passwordMatch = await bcrypt.compare(password, user.password);

                if (!passwordMatch) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                const token = generateToken(user);

                return res.json({
                    status: "success",
                    message: "Admin login successful",
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role
                    }
                });
            }

            if (requestedRole === "faculty") {
                const user = db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role = 'faculty'
                `).get(username);

                if (!user) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid faculty credentials"
                    });
                }

                const passwordMatch = await bcrypt.compare(password, user.password);
                if (!passwordMatch) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid faculty credentials"
                    });
                }

                const faculty = db.prepare(`
                    SELECT *
                    FROM faculty
                    WHERE user_id = ?
                `).get(user.id);

                const token = generateToken(user);
                return res.json({
                    status: "success",
                    message: "Faculty login successful",
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role
                    },
                    faculty: faculty || {
                        id: null,
                        faculty_id: "FAC-1001",
                        full_name: "Demo Faculty",
                        department: "Computer Science"
                    }
                });
            }

            if (requestedRole === "student") {
                const user = db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role = 'student'
                `).get(username);

                if (!user) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid username or password"
                    });
                }

                const passwordMatch = await bcrypt.compare(password, user.password);
                if (!passwordMatch) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid username or password"
                    });
                }

                const student = db.prepare(`
                    SELECT *
                    FROM students
                    WHERE user_id = ?
                `).get(user.id);

                if (!student) {
                    return res.status(404).json({
                        status: "error",
                        message: "Student profile not found"
                    });
                }

                const token = generateToken(user);
                return res.json({
                    status: "success",
                    message: "Student login successful",
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role
                    },
                    student: {
                        id: student.id,
                        student_id: student.student_id,
                        roll_number: student.roll_number,
                        full_name: student.full_name,
                        department: student.department
                    }
                });
            }

            const adminUser = db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                AND role IN ('admin', 'superadmin')
            `).get(username);

            if (adminUser) {
                if (adminUser.username !== ALLOWED_ADMIN_USERNAME) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                const passwordMatch = await bcrypt.compare(password, adminUser.password);
                if (passwordMatch) {
                    const token = generateToken(adminUser);
                    return res.json({
                        status: "success",
                        message: "Admin login successful",
                        token,
                        user: {
                            id: adminUser.id,
                            username: adminUser.username,
                            role: adminUser.role
                        }
                    });
                }
            }

            const facultyUser = db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                AND role = 'faculty'
            `).get(username);

            if (facultyUser) {
                const passwordMatch = await bcrypt.compare(password, facultyUser.password);
                if (passwordMatch) {
                    const faculty = db.prepare(`
                        SELECT *
                        FROM faculty
                        WHERE user_id = ?
                    `).get(facultyUser.id);

                    const token = generateToken(facultyUser);
                    return res.json({
                        status: "success",
                        message: "Faculty login successful",
                        token,
                        user: {
                            id: facultyUser.id,
                            username: facultyUser.username,
                            role: facultyUser.role
                        },
                        faculty: faculty || {
                            id: null,
                            faculty_id: "FAC-1001",
                            full_name: "Demo Faculty",
                            department: "Computer Science"
                        }
                    });
                }
            }

            const studentUser = db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                AND role = 'student'
            `).get(username);

            if (!studentUser) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid username or password"
                });
            }

            const passwordMatch = await bcrypt.compare(password, studentUser.password);
            if (!passwordMatch) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid username or password"
                });
            }

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(studentUser.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const token = generateToken(studentUser);
            return res.json({
                status: "success",
                message: "Student login successful",
                token,
                user: {
                    id: studentUser.id,
                    username: studentUser.username,
                    role: studentUser.role
                },
                student: {
                    id: student.id,
                    student_id: student.student_id,
                    roll_number: student.roll_number,
                    full_name: student.full_name,
                    department: student.department
                }
            });

        } catch (error) {
            console.error("Generic login error:", error);
            return res.status(500).json({
                status: "error",
                message: "Server error during login"
            });
        }
    }
);


// ============================================================
// STUDENT REGISTRATION
// ============================================================

app.post(
    "/api/student/register",
    async (req, res) => {

        try {

            const {

                username,
                password,

                full_name,
                student_id,
                roll_number,

                email,
                mobile,

                dob,
                gender,

                department,
                year,
                section,
                academic_year,

                fee_category,

                parent_name,
                parent_mobile,
                parent_email,

                address,
                city,
                district,
                state,
                pincode,

                profile_photo,
                linkedin_url,
                github_url,
                instagram_url,
                other_link_url,
                portfolio_url

            } = req.body;

            const normalizedStudentId = String(roll_number || student_id || "").trim();
            const normalizedRollNumber = String(roll_number || student_id || "").trim();


            // Required fields

            if (
                !username ||
                !password ||
                !full_name ||
                !normalizedStudentId ||
                !email
            ) {

                return res.status(400).json({

                    status: "error",

                    message:
                        "Username, password, full name, roll number and email are required"

                });

            }

            const registrationLinks = validateOptionalProfileLinks({
                linkedin_url,
                github_url,
                instagram_url,
                other_link_url,
                portfolio_url
            });

            if (registrationLinks.error) {
                return res.status(400).json({
                    status: "error",
                    message: registrationLinks.error
                });
            }


            // Check username

            const existingUsername =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE username = ?
                `).get(username);


            if (existingUsername) {

                return res.status(409).json({

                    status: "error",

                    message:
                        "Username already exists"

                });

            }


            // Check student ID

            const existingStudent =
                db.prepare(`
                    SELECT id
                    FROM students
                    WHERE student_id = ? OR roll_number = ?
                `).get(normalizedStudentId, normalizedRollNumber);


            if (existingStudent) {

                return res.status(409).json({

                    status: "error",

                    message:
                        "Student ID already exists"

                });

            }


            // Hash password

            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );


            // Create user

            const userResult =
                db.prepare(`
                    INSERT INTO users
                    (
                        username,
                        password,
                        role
                    )
                    VALUES (?, ?, 'student')
                `).run(
                    username,
                    hashedPassword
                );


            const userId =
                userResult.lastInsertRowid;


            // Create student

            db.prepare(`
                INSERT INTO students
                (
                    user_id,
                    student_id,
                    roll_number,
                    full_name,
                    email,
                    mobile,
                    dob,
                    gender,
                    department,
                    year,
                    section,
                    academic_year,
                    fee_category,
                    parent_name,
                    parent_mobile,
                    parent_email,
                    address,
                    city,
                    district,
                    state,
                    pincode,
                    profile_photo,
                    linkedin_url,
                    github_url,
                    instagram_url,
                    other_link_url,
                    portfolio_url
                )

                VALUES
                (
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?
                )
            `).run(

                userId,

                normalizedStudentId,
                normalizedRollNumber,

                full_name,

                email,
                mobile || null,

                dob || null,
                gender || null,

                department || null,
                year || null,
                section || null,
                academic_year || null,

                fee_category || null,

                parent_name || null,
                parent_mobile || null,
                parent_email || null,

                address || null,
                city || null,
                district || null,
                state || null,
                pincode || null,

                profile_photo || null,
                registrationLinks.links.linkedin_url || null,
                registrationLinks.links.github_url || null,
                registrationLinks.links.instagram_url || null,
                registrationLinks.links.other_link_url || null,
                registrationLinks.links.portfolio_url || null

            );


            const registeredStudent = db.prepare(`
                SELECT id, student_id, full_name, department, year, section, academic_year
                FROM students
                WHERE user_id = ?
            `).get(userId);

            const token = generateToken({
                id: userId,
                username,
                role: "student"
            });

            return res.status(201).json({

                status: "success",

                message:
                    "Student registration successful. You are now logged in.",

                token,
                user: {
                    id: userId,
                    username,
                    role: "student"
                },
                student: registeredStudent

            });


        } catch (error) {

            console.error(
                "Student registration error:",
                error
            );


            return res.status(500).json({

                status: "error",

                message:
                    "Student registration failed"

            });

        }

    }
);


// ============================================================
// STUDENT LOGIN
// ============================================================

app.post(
    "/api/faculty/login",
    async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    status: "error",
                    message: "Username and password are required"
                });
            }

            const user = db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                  AND role = 'faculty'
            `).get(username);

            if (!user) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid faculty credentials"
                });
            }

            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid faculty credentials"
                });
            }

            const faculty = db.prepare(`
                SELECT *
                FROM faculty
                WHERE user_id = ?
            `).get(user.id);

            const token = generateToken(user);

            return res.json({
                status: "success",
                message: "Faculty login successful",
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role
                },
                faculty: faculty || {
                    id: null,
                    faculty_id: "FAC-1001",
                    full_name: "Demo Faculty",
                    department: "Computer Science"
                }
            });
        } catch (error) {
            console.error("Faculty login error:", error);
            return res.status(500).json({
                status: "error",
                message: "Server error during faculty login"
            });
        }
    }
);

app.get(
    "/api/faculty/dashboard",
    authenticateToken,
    requireFaculty,
    (req, res) => {
        try {
            const faculty = db.prepare(`
                SELECT *
                FROM faculty
                WHERE user_id = ?
            `).get(req.user.id);

            if (!faculty) {
                return res.status(404).json({
                    status: "error",
                    message: "Faculty profile not found"
                });
            }

            const studentCount = db.prepare(`SELECT COUNT(*) AS count FROM students`).get().count;
            const attendanceCount = db.prepare(`SELECT COUNT(*) AS count FROM attendance`).get().count;
            const notificationCount = db.prepare(`SELECT COUNT(*) AS count FROM notifications`).get().count;
            const subjects = db.prepare(`
                SELECT *
                FROM subjects
                WHERE department = ?
                ORDER BY id DESC
                LIMIT 5
            `).all(faculty.department || "Computer Science");

            return res.json({
                status: "success",
                faculty,
                summary: {
                    total_students: Number(studentCount || 0),
                    total_attendance_records: Number(attendanceCount || 0),
                    total_notifications: Number(notificationCount || 0)
                },
                subjects
            });
        } catch (error) {
            console.error("Faculty dashboard error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.post(
    "/api/student/login",
    async (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;


            if (
                !username ||
                !password
            ) {

                return res.status(400).json({

                    status: "error",

                    message:
                        "Username and password are required"

                });

            }


            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role = 'student'
                `).get(username);


            if (!user) {

                return res.status(401).json({

                    status: "error",

                    message:
                        "Invalid username or password"

                });

            }


            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.password
                );


            if (!passwordMatch) {

                return res.status(401).json({

                    status: "error",

                    message:
                        "Invalid username or password"

                });

            }


            const student =
                db.prepare(`
                    SELECT *
                    FROM students
                    WHERE user_id = ?
                `).get(user.id);


            if (!student) {

                return res.status(404).json({

                    status: "error",

                    message:
                        "Student profile not found"

                });

            }


            const token =
                generateToken(user);


            return res.json({

                status: "success",

                message:
                    "Student login successful",

                token,

                user: {

                    id: user.id,

                    username: user.username,

                    role: user.role

                },

                student: {

                    id: student.id,

                    student_id:
                        student.student_id,

                    roll_number:
                        student.roll_number,

                    full_name:
                        student.full_name,

                    department:
                        student.department

                }

            });


        } catch (error) {

            console.error(
                "Student login error:",
                error
            );


            return res.status(500).json({

                status: "error",

                message:
                    "Server error during login"

            });

        }

    }
);


// ============================================================
// PARENT LOGIN
// ============================================================

app.post(
    "/api/parent/login",
    async (req, res) => {

        try {

            const {
                student_id: studentId,
                parent_mobile: parentMobile,
                parent_email: parentEmail
            } = req.body;

            if (!studentId || (!parentMobile && !parentEmail)) {
                return res.status(400).json({
                    status: "error",
                    message: "Student ID and parent mobile or email are required"
                });
            }

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE student_id = ?
                  AND (
                    parent_mobile = ? OR parent_email = ?
                  )
            `).get(
                String(studentId).trim(),
                parentMobile ? String(parentMobile).trim() : null,
                parentEmail ? String(parentEmail).trim() : null
            );

            if (!student) {
                return res.status(401).json({
                    status: "error",
                    message: "Parent credentials do not match any student record"
                });
            }

            const token = jwt.sign(
                {
                    id: student.user_id,
                    role: "parent",
                    parent_name: student.parent_name,
                    student_id: student.student_id
                },
                JWT_SECRET,
                { expiresIn: "1d" }
            );

            return res.json({
                status: "success",
                message: "Parent login successful",
                token,
                student: {
                    id: student.id,
                    student_id: student.student_id,
                    full_name: student.full_name,
                    department: student.department,
                    year: student.year,
                    section: student.section,
                    parent_name: student.parent_name
                }
            });

        } catch (error) {
            console.error("Parent login error:", error);
            return res.status(500).json({
                status: "error",
                message: "Server error during parent login"
            });
        }
    }
);

app.get(
    "/api/parent/dashboard",
    authenticateToken,
    requireParent,
    (req, res) => {
        try {
            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE student_id = ?
            `).get(req.user.student_id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Linked student record not found"
                });
            }

            const feeSummary = db.prepare(`
                SELECT
                    COALESCE(SUM(total_amount), 0) AS total_amount,
                    COALESCE(SUM(paid_amount), 0) AS paid_amount,
                    COALESCE(SUM(pending_amount), 0) AS pending_amount,
                    COUNT(*) AS records
                FROM fees
                WHERE student_id = ?
            `).get(student.id);

            const attendance = db.prepare(`
                SELECT
                    a.id,
                    a.student_id,
                    a.subject AS subject_name,
                    a.subject AS subject_code,
                    a.attendance_date,
                    a.status
                FROM attendance a
                WHERE a.student_id = ?
                ORDER BY a.attendance_date DESC
                LIMIT 20
            `).all(student.id);

            const marks = db.prepare(`
                SELECT
                    m.id,
                    m.student_id,
                    m.subject_id,
                    m.exam_type,
                    m.marks AS total_marks,
                    m.max_marks,
                    COALESCE(s.name, 'Subject ' || m.subject_id) AS subject_name,
                    COALESCE(s.code, 'SUBJ') AS subject_code,
                    COALESCE(m.exam_date, '') AS created_at
                FROM marks m
                LEFT JOIN subjects s ON s.id = m.subject_id
                WHERE m.student_id = ?
                ORDER BY COALESCE(m.exam_date, '') DESC, m.id DESC
                LIMIT 20
            `).all(student.id);

            const notifications = db.prepare(`
                SELECT *
                FROM notifications
                WHERE audience = 'All'
                   OR audience = 'Parents'
                ORDER BY created_at DESC
                LIMIT 20
            `).all();

            return res.json({
                status: "success",
                student,
                feeSummary,
                attendance,
                marks,
                notifications
            });

        } catch (error) {
            console.error("Parent dashboard error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.get(
    "/api/parent/student-profile",
    authenticateToken,
    requireParent,
    (req, res) => {
        try {
            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE student_id = ?
            `).get(req.user.student_id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Linked student record not found"
                });
            }

            const attendance = db.prepare(`
                SELECT
                    a.id,
                    a.student_id,
                    a.subject AS subject_name,
                    a.subject AS subject_code,
                    a.attendance_date,
                    a.status
                FROM attendance a
                WHERE a.student_id = ?
                ORDER BY a.attendance_date DESC
                LIMIT 30
            `).all(student.id);

            const marks = db.prepare(`
                SELECT
                    m.id,
                    m.student_id,
                    m.subject_id,
                    m.exam_type,
                    m.marks AS total_marks,
                    m.max_marks,
                    COALESCE(s.name, 'Subject ' || m.subject_id) AS subject_name,
                    COALESCE(s.code, 'SUBJ') AS subject_code,
                    COALESCE(m.exam_date, '') AS created_at
                FROM marks m
                LEFT JOIN subjects s ON s.id = m.subject_id
                WHERE m.student_id = ?
                ORDER BY COALESCE(m.exam_date, '') DESC, m.id DESC
                LIMIT 30
            `).all(student.id);

            const fees = db.prepare(`
                SELECT *
                FROM fees
                WHERE student_id = ?
                ORDER BY academic_year DESC, fee_year DESC
            `).all(student.id);

            const notifications = db.prepare(`
                SELECT *
                FROM notifications
                WHERE audience = 'All'
                   OR audience = 'Parents'
                ORDER BY created_at DESC
                LIMIT 20
            `).all();

            return res.json({
                status: "success",
                student,
                attendance,
                marks,
                fees,
                notifications
            });

        } catch (error) {
            console.error("Parent student profile error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);


// ============================================================
// ADMIN LOGIN
// ============================================================

app.post(
    "/api/admin/login",
    async (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;


            if (
                !username ||
                !password
            ) {

                return res.status(400).json({

                    status: "error",

                    message:
                        "Username and password are required"

                });

            }


            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role IN ('admin', 'superadmin')
                `).get(username);


            if (!user) {

                return res.status(401).json({

                    status: "error",

                    message:
                        "Invalid admin credentials"

                });

            }


            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.password
                );


            if (!passwordMatch) {

                return res.status(401).json({

                    status: "error",

                    message:
                        "Invalid admin credentials"

                });

            }


            const token =
                generateToken(user);


            return res.json({

                status: "success",

                message:
                    "Admin login successful",

                token,

                user: {

                    id: user.id,

                    username:
                        user.username,

                    role:
                        user.role

                }

            });


        } catch (error) {

            console.error(
                "Admin login error:",
                error
            );


            return res.status(500).json({

                status: "error",

                message:
                    "Server error during admin login"

            });

        }

    }
);


// ============================================================
// ADMIN STUDENTS
// ============================================================

app.get(
    "/api/admin/students",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const department = String(req.query.department || "").trim().slice(0, 80);
            const where = [];
            const params = [];

            if (search) {
                where.push("(s.full_name LIKE ? OR s.student_id LIKE ? OR s.roll_number LIKE ? OR s.email LIKE ?)");
                const pattern = `%${search}%`;
                params.push(pattern, pattern, pattern, pattern);
            }
            if (department) {
                where.push("s.department = ?");
                params.push(department);
            }
            const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

            const students = db.prepare(`
                SELECT s.*, u.username
                FROM students s
                LEFT JOIN users u ON u.id = s.user_id
                ${whereSql}
                ORDER BY s.id DESC
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);
            const total = db.prepare(`
                SELECT COUNT(*) AS total
                FROM students s
                ${whereSql}
            `).get(...params).total;

            return res.json({
                status: "success",
                count: total,
                students,
                pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
            });

        } catch (error) {

            console.error("Admin students error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }

    }
);

app.get(
    "/api/admin/students/export",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const students = db.prepare(`
                SELECT
                    s.id,
                    s.full_name,
                    s.student_id,
                    s.roll_number,
                    s.email,
                    s.mobile,
                    s.department,
                    s.year,
                    s.section,
                    s.academic_year,
                    s.fee_category,
                    u.username
                FROM students s
                LEFT JOIN users u ON u.id = s.user_id
                ORDER BY s.id DESC
            `).all();

            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(students);
            XLSX.utils.book_append_sheet(workbook, worksheet, "Students");
            const buffer = XLSX.write(workbook, {
                type: "buffer",
                bookType: "xlsx"
            });

            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            res.setHeader(
                "Content-Disposition",
                "attachment; filename=khit-students.xlsx"
            );

            return res.send(buffer);

        } catch (error) {

            console.error("Student export error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/students/import-preview",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        upload.single("file")(req, res, error => {

            if (error) {
                return res.status(400).json({
                    status: "error",
                    message: "A valid XLSX, XLS, or CSV file under 10 MB is required"
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    status: "error",
                    message: "Import file is required"
                });
            }

            try {

                const workbook = XLSX.readFile(req.file.path, {
                    cellDates: true
                });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(firstSheet, {
                    defval: ""
                });
                const requiredColumns = [
                    "full_name",
                    "student_id",
                    "roll_number",
                    "email"
                ];
                const columns = rows.length ? Object.keys(rows[0]) : [];
                const missingColumns = requiredColumns.filter(
                    column => !columns.includes(column)
                );

                return res.json({
                    status: "success",
                    sheet: workbook.SheetNames[0] || null,
                    total_rows: rows.length,
                    columns,
                    missing_columns: missingColumns,
                    valid_template: missingColumns.length === 0,
                    preview: rows.slice(0, 20)
                });

            } catch (parseError) {

                return res.status(400).json({
                    status: "error",
                    message: "Unable to read the spreadsheet"
                });

            } finally {
                fs.unlink(req.file.path, () => {});
            }
        });
    }
);


// ============================================================
// ADMIN FACULTY
// ============================================================

app.get(
    "/api/admin/faculty",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const where = search
                ? "WHERE full_name LIKE ? OR faculty_id LIKE ? OR email LIKE ?"
                : "";
            const searchParams = search
                ? [`%${search}%`, `%${search}%`, `%${search}%`]
                : [];

            const faculty = db.prepare(`
                SELECT
                    id,
                    faculty_id,
                    full_name,
                    department,
                    designation,
                    email,
                    mobile,
                    created_at
                FROM faculty
                ${where}
                ORDER BY id DESC
                LIMIT ? OFFSET ?
            `).all(...searchParams, limit, offset);
            const total = db.prepare(`
                SELECT COUNT(*) AS total FROM faculty ${where}
            `).get(...searchParams).total;

            return res.json({
                status: "success",
                count: total,
                faculty,
                pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
            });

        } catch (error) {

            console.error("Admin faculty load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/faculty",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const {
                faculty_id: facultyId,
                full_name: fullName,
                department,
                designation,
                email,
                mobile
            } = req.body;

            if (!facultyId || !fullName) {
                return res.status(400).json({
                    status: "error",
                    message: "Faculty ID and full name are required"
                });
            }

            const result = db.prepare(`
                INSERT INTO faculty
                    (faculty_id, full_name, department, designation, email, mobile, user_id)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
            `).run(
                facultyId.trim(),
                fullName.trim(),
                department?.trim() || null,
                designation?.trim() || null,
                email?.trim() || null,
                mobile?.trim() || null
            );

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "CREATE",
                "faculty",
                result.lastInsertRowid,
                JSON.stringify({ facultyId, fullName })
            );

            return res.status(201).json({
                status: "success",
                message: "Faculty record created",
                faculty_id: result.lastInsertRowid
            });

        } catch (error) {

            if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
                return res.status(409).json({
                    status: "error",
                    message: "Faculty ID already exists"
                });
            }

            console.error("Admin faculty create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.delete(
    "/api/admin/faculty/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const facultyId = Number(req.params.id);
            const result = db.prepare(`
                DELETE FROM faculty
                WHERE id = ?
            `).run(facultyId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Faculty record not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `).run(req.user.id, "DELETE", "faculty", facultyId);

            return res.json({
                status: "success",
                message: "Faculty record deleted"
            });

        } catch (error) {

            console.error("Admin faculty delete error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// ADMIN FEES
// ============================================================

app.get(
    "/api/admin/fees",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const where = search
                ? "WHERE s.full_name LIKE ? OR s.student_id LIKE ? OR s.roll_number LIKE ?"
                : "";
            const searchParams = search
                ? [`%${search}%`, `%${search}%`, `%${search}%`]
                : [];

            const fees = db.prepare(`
                SELECT
                    f.*,
                    s.full_name,
                    s.student_id AS student_code,
                    s.roll_number
                FROM fees f
                LEFT JOIN students s ON s.id = f.student_id
                ${where}
                ORDER BY f.id DESC
                LIMIT ? OFFSET ?
            `).all(...searchParams, limit, offset);

            const total = db.prepare(`
                SELECT COUNT(*) AS total
                FROM fees f
                LEFT JOIN students s ON s.id = f.student_id
                ${where}
            `).get(...searchParams).total;

            const summary = db.prepare(`
                SELECT
                    COUNT(*) AS records,
                    COALESCE(SUM(total_amount), 0) AS total_amount,
                    COALESCE(SUM(paid_amount), 0) AS paid_amount,
                    COALESCE(SUM(pending_amount), 0) AS pending_amount
                FROM fees
            `).get();

            return res.json({
                status: "success",
                fees,
                summary,
                pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
            });

        } catch (error) {

            console.error("Admin fees load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/fees",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const {
                student_id: studentId,
                academic_year: academicYear,
                fee_year: feeYear,
                total_amount: totalAmount
            } = req.body;

            const numericStudentId = Number(studentId);
            const numericFeeYear = Number(feeYear);
            const numericTotal = Number(totalAmount);

            if (!numericStudentId || !academicYear || !numericFeeYear || !Number.isFinite(numericTotal) || numericTotal < 0) {
                return res.status(400).json({
                    status: "error",
                    message: "Student, academic year, fee year, and a valid total amount are required"
                });
            }

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE id = ?
            `).get(numericStudentId);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student record not found"
                });
            }

            const result = db.prepare(`
                INSERT INTO fees
                    (student_id, academic_year, fee_year, total_amount, paid_amount, pending_amount, status)
                VALUES (?, ?, ?, ?, 0, ?, 'Pending')
            `).run(
                numericStudentId,
                academicYear.trim(),
                numericFeeYear,
                numericTotal,
                numericTotal
            );

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "CREATE",
                "fee",
                result.lastInsertRowid,
                JSON.stringify({ studentId: numericStudentId, academicYear, feeYear, totalAmount: numericTotal })
            );

            return res.status(201).json({
                status: "success",
                message: "Fee record created",
                fee_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin fee create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.delete(
    "/api/admin/fees/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const feeId = Number(req.params.id);
            const result = db.prepare(`
                DELETE FROM fees
                WHERE id = ?
            `).run(feeId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Fee record not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `).run(req.user.id, "DELETE", "fee", feeId);

            return res.json({
                status: "success",
                message: "Fee record deleted"
            });

        } catch (error) {

            console.error("Admin fee delete error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// ADMIN BUS MANAGEMENT
// ============================================================

app.get(
    "/api/admin/buses",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const buses = db.prepare(`
                SELECT *
                FROM buses
                ORDER BY id DESC
            `).all();

            const stops = db.prepare(`
                SELECT *
                FROM bus_stops
                ORDER BY bus_id, id
            `).all();

            return res.json({
                status: "success",
                buses,
                stops
            });

        } catch (error) {

            console.error("Admin buses load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/buses",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const busNumber = String(req.body.bus_number || "").trim();
            const routeName = String(req.body.route_name || "").trim();

            if (!busNumber) {
                return res.status(400).json({
                    status: "error",
                    message: "Bus number is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO buses (bus_number, route)
                VALUES (?, ?)
            `).run(busNumber, routeName || null);

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "CREATE",
                "bus",
                result.lastInsertRowid,
                JSON.stringify({ busNumber, routeName })
            );

            return res.status(201).json({
                status: "success",
                message: "Bus created",
                bus_id: result.lastInsertRowid
            });

        } catch (error) {

            if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
                return res.status(409).json({
                    status: "error",
                    message: "Bus number already exists"
                });
            }

            console.error("Admin bus create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/buses/:id/stops",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const busId = Number(req.params.id);
            const stopName = String(req.body.stop_name || "").trim();
            const pickupTime = String(req.body.pickup_time || "").trim();

            if (!busId || !stopName) {
                return res.status(400).json({
                    status: "error",
                    message: "Bus and stop name are required"
                });
            }

            const bus = db.prepare("SELECT id FROM buses WHERE id = ?").get(busId);
            if (!bus) {
                return res.status(404).json({
                    status: "error",
                    message: "Bus not found"
                });
            }

            const result = db.prepare(`
                INSERT INTO bus_stops (bus_id, stop_name, pickup_time)
                VALUES (?, ?, ?)
            `).run(busId, stopName, pickupTime || null);

            return res.status(201).json({
                status: "success",
                message: "Bus stop created",
                stop_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin bus stop create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.delete(
    "/api/admin/buses/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const busId = Number(req.params.id);
            const result = db.prepare("DELETE FROM buses WHERE id = ?").run(busId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Bus not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `).run(req.user.id, "DELETE", "bus", busId);

            return res.json({
                status: "success",
                message: "Bus deleted"
            });

        } catch (error) {

            console.error("Admin bus delete error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// ADMIN EVENTS AND ANNOUNCEMENTS
// ============================================================

app.get(
    "/api/admin/events",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const events = db.prepare(`
                SELECT *
                FROM events
                ORDER BY event_date DESC, id DESC
            `).all();

            const announcements = db.prepare(`
                SELECT *
                FROM announcements
                ORDER BY id DESC
            `).all();

            return res.json({
                status: "success",
                events,
                announcements
            });

        } catch (error) {

            console.error("Admin events load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/events",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const title = String(req.body.title || "").trim();
            const description = String(req.body.description || "").trim();
            const eventDate = String(req.body.event_date || "").trim();
            const eventTime = String(req.body.event_time || "").trim();
            const venue = String(req.body.venue || "").trim();
            const category = String(req.body.category || "General").trim();
            const audience = String(req.body.audience || "All").trim();

            if (!title) {
                return res.status(400).json({
                    status: "error",
                    message: "Event title is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO events
                    (title, description, event_date, event_time, venue, category, audience, published)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            `).run(
                title,
                description || null,
                eventDate || null,
                eventTime || null,
                venue || null,
                category,
                audience
            );

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(req.user.id, "CREATE", "event", result.lastInsertRowid, JSON.stringify({ title }));

            return res.status(201).json({
                status: "success",
                message: "Event created",
                event_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin event create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.patch(
    "/api/admin/events/:id/publish",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const eventId = Number(req.params.id);
            const published = req.body.published ? 1 : 0;
            const result = db.prepare(`
                UPDATE events
                SET published = ?
                WHERE id = ?
            `).run(published, eventId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Event not found"
                });
            }

            return res.json({
                status: "success",
                message: published ? "Event published" : "Event unpublished"
            });

        } catch (error) {

            console.error("Admin event publish error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.delete(
    "/api/admin/events/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const eventId = Number(req.params.id);
            const result = db.prepare("DELETE FROM events WHERE id = ?").run(eventId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Event not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `).run(req.user.id, "DELETE", "event", eventId);

            return res.json({
                status: "success",
                message: "Event deleted"
            });

        } catch (error) {

            console.error("Admin event delete error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/announcements",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const title = String(req.body.title || "").trim();
            const description = String(req.body.description || "").trim();
            const audience = String(req.body.audience || "All Students").trim();

            if (!title) {
                return res.status(400).json({
                    status: "error",
                    message: "Announcement title is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO announcements (title, description, audience, published)
                VALUES (?, ?, ?, 0)
            `).run(title, description || null, audience);

            return res.status(201).json({
                status: "success",
                message: "Announcement created",
                announcement_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin announcement create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// ADMIN DASHBOARD STATISTICS
// ============================================================

app.get(
    "/api/admin/stats",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const counts = db.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM students) AS students,
                    (SELECT COUNT(*) FROM faculty) AS faculty,
                    (SELECT COUNT(*) FROM notifications) AS notifications,
                    (SELECT COUNT(*) FROM events) AS events,
                    (SELECT COUNT(*) FROM fees) AS fees
            `).get();

            return res.json({
                status: "success",
                stats: {
                    students: Number(counts.students || 0),
                    faculty: Number(counts.faculty || 0),
                    notifications: Number(counts.notifications || 0),
                    events: Number(counts.events || 0),
                    fees: Number(counts.fees || 0)
                }
            });

        } catch (error) {

            console.error("Admin statistics error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }

    }
);

app.get(
    "/api/admin/reports",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const summary = db.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM students) AS students,
                    (SELECT COUNT(*) FROM faculty) AS faculty,
                    (SELECT COUNT(*) FROM notifications) AS notifications,
                    (SELECT COUNT(*) FROM events) AS events,
                    (SELECT COALESCE(SUM(total_amount), 0) FROM fees) AS fee_total,
                    (SELECT COALESCE(SUM(paid_amount), 0) FROM fees) AS fee_paid,
                    (SELECT COALESCE(SUM(pending_amount), 0) FROM fees) AS fee_pending,
                    (SELECT COUNT(*) FROM attendance WHERE status = 'Present') AS attendance_present,
                    (SELECT COUNT(*) FROM attendance WHERE status = 'Absent') AS attendance_absent,
                    (SELECT COUNT(*) FROM attendance WHERE status = 'Leave') AS attendance_leave
            `).get();

            const departmentBreakdown = db.prepare(`
                SELECT department,
                       COUNT(*) AS total_students
                FROM students
                WHERE department IS NOT NULL AND TRIM(department) != ''
                GROUP BY department
                ORDER BY total_students DESC, department ASC
            `).all();

            const feeStatusBreakdown = db.prepare(`
                SELECT status,
                       COUNT(*) AS total_records
                FROM fees
                GROUP BY status
                ORDER BY total_records DESC, status ASC
            `).all();

            const recentAnnouncements = db.prepare(`
                SELECT title,
                       message,
                       created_at
                FROM notifications
                ORDER BY created_at DESC
                LIMIT 5
            `).all();

            return res.json({
                status: "success",
                summary: {
                    students: Number(summary.students || 0),
                    faculty: Number(summary.faculty || 0),
                    notifications: Number(summary.notifications || 0),
                    events: Number(summary.events || 0),
                    fee_total: Number(summary.fee_total || 0),
                    fee_paid: Number(summary.fee_paid || 0),
                    fee_pending: Number(summary.fee_pending || 0),
                    attendance_present: Number(summary.attendance_present || 0),
                    attendance_absent: Number(summary.attendance_absent || 0),
                    attendance_leave: Number(summary.attendance_leave || 0)
                },
                departmentBreakdown,
                feeStatusBreakdown,
                recentAnnouncements
            });

        } catch (error) {
            console.error("Admin reports error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);


// ============================================================
// STUDENT PROFILE
// ============================================================

app.get(
    "/api/student/profile",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student =
                db.prepare(`
                    SELECT
                        *
                    FROM students
                    WHERE user_id = ?
                `).get(req.user.id);


            if (!student) {

                return res.status(404).json({

                    status: "error",

                    message:
                        "Student profile not found"

                });

            }


            return res.json({

                status: "success",

                student

            });


        } catch (error) {

            console.error(
                "Profile error:",
                error
            );


            return res.status(500).json({

                status: "error",

                message:
                    "Unable to load profile"

            });

        }

    }
);

app.patch(
    "/api/student/profile",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const allowedFields = [
                "full_name",
                "email",
                "mobile",
                "dob",
                "gender",
                "department",
                "year",
                "section",
                "academic_year",
                "fee_category",
                "parent_name",
                "parent_mobile",
                "parent_email",
                "address",
                "city",
                "district",
                "state",
                "pincode",
                "profile_photo",
                "linkedin_url",
                "github_url",
                "instagram_url",
                "other_link_url",
                "portfolio_url"
            ];

            const payload = req.body || {};
            const updates = {};

            const profileLinks = validateOptionalProfileLinks(payload);
            if (profileLinks.error) {
                return res.status(400).json({
                    status: "error",
                    message: profileLinks.error
                });
            }

            allowedFields.forEach((field) => {
                if (Object.prototype.hasOwnProperty.call(payload, field)) {
                    if (Object.prototype.hasOwnProperty.call(profileLinks.links, field)) {
                        updates[field] = profileLinks.links[field];
                    } else {
                        const value = payload[field];
                        updates[field] = value === "" || value === null || value === undefined ? null : String(value).trim();
                    }
                }
            });

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({
                    status: "error",
                    message: "No valid profile fields supplied"
                });
            }

            const sql = [
                "UPDATE students SET"
            ];
            const params = [];

            Object.entries(updates).forEach(([field, value], index) => {
                sql.push(`${field} = ?` + (index < Object.keys(updates).length - 1 ? "," : ""));
                params.push(value);
            });

            sql.push("WHERE user_id = ?");
            params.push(req.user.id);

            db.prepare(sql.join(" ")).run(...params);

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "UPDATE_PROFILE",
                "student",
                student.id,
                JSON.stringify({ updatedFields: Object.keys(updates) })
            );

            const updatedStudent = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            return res.json({
                status: "success",
                message: "Profile updated successfully",
                student: updatedStudent
            });

        } catch (error) {
            console.error("Profile update error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message || "Unable to update profile"
            });
        }
    }
);


// ============================================================
// STUDENT ACADEMIC RECORDS
// ============================================================

app.get(
    "/api/student/academics",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id, department, year, section
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const subjects = db.prepare(`
                SELECT id, code, name, department, year, semester, section
                FROM subjects
                WHERE (department IS NULL OR department = ?)
                  AND (year IS NULL OR year = ?)
                  AND (section IS NULL OR section = ?)
                ORDER BY semester, code, name
            `).all(student.department, student.year, student.section);

            return res.json({
                status: "success",
                subjects
            });

        } catch (error) {

            console.error("Student academics error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/fees",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id, year
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const fees = db.prepare(`
                SELECT *
                FROM fees
                WHERE student_id = ?
                ORDER BY fee_year DESC, id DESC
            `).all(student.id);

            const payments = db.prepare(`
                SELECT *
                FROM fee_payments
                WHERE student_id = ?
                ORDER BY payment_date DESC, id DESC
            `).all(student.id);

            return res.json({
                status: "success",
                student: {
                    year: student.year
                },
                fees,
                payments,
                summary: {
                    total: fees.reduce((sum, fee) => sum + Number(fee.total_amount || 0), 0),
                    paid: fees.reduce((sum, fee) => sum + Number(fee.paid_amount || 0), 0),
                    pending: fees.reduce((sum, fee) => sum + Number(fee.pending_amount || 0), 0)
                }
            });

        } catch (error) {

            console.error("Student fees error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/student/fees/pay",
    authenticateToken,
    requireStudent,
    (req, res) => {
        try {
            const student = db.prepare(`
                SELECT id, year
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const feeId = Number(req.body.fee_id);
            const amount = Number(req.body.amount);
            const method = String(req.body.method || "Online").trim();
            const transactionId = String(req.body.transaction_id || "TXN-" + Date.now()).trim();

            if (!Number.isFinite(feeId) || feeId <= 0) {
                return res.status(400).json({
                    status: "error",
                    message: "A valid fee record is required"
                });
            }

            if (!Number.isFinite(amount) || amount <= 0) {
                return res.status(400).json({
                    status: "error",
                    message: "Payment amount must be greater than 0"
                });
            }

            const fee = db.prepare(`
                SELECT *
                FROM fees
                WHERE id = ? AND student_id = ?
            `).get(feeId, student.id);

            if (!fee) {
                return res.status(404).json({
                    status: "error",
                    message: "Fee record not found"
                });
            }

            const currentYear = Math.min(4, Math.max(1, Number(student.year) || 1));
            if (Number(fee.fee_year) > currentYear) {
                return res.status(400).json({
                    status: "error",
                    message: "This fee year is locked until your current academic year is completed"
                });
            }

            const previousYears = db.prepare(`
                SELECT fee_year, pending_amount, status
                FROM fees
                WHERE student_id = ? AND fee_year < ?
            `).all(student.id, fee.fee_year);
            const previousYearComplete = Array.from(
                { length: Math.max(0, Number(fee.fee_year) - 1) },
                (_, index) => index + 1
            ).every(year => {
                const previousFee = previousYears.find(item => Number(item.fee_year) === year);
                return previousFee && (
                    Number(previousFee.pending_amount || 0) <= 0 ||
                    String(previousFee.status || '').toLowerCase() === "paid"
                );
            });

            if (!previousYearComplete) {
                return res.status(400).json({
                    status: "error",
                    message: "Complete all previous fee years before paying this fee year"
                });
            }

            const pendingAmount = Number(fee.pending_amount || 0);
            if (amount > pendingAmount && pendingAmount > 0) {
                return res.status(400).json({
                    status: "error",
                    message: `Amount exceeds remaining balance. Remaining balance is ${pendingAmount}`
                });
            }

            const nextPaid = Number(fee.paid_amount || 0) + amount;
            const nextPending = Math.max(Number(fee.total_amount || 0) - nextPaid, 0);
            const nextStatus = nextPending > 0 ? "Pending" : "Paid";

            db.prepare(`
                INSERT INTO fee_payments
                    (student_id, amount, payment_mode, transaction_id, payment_reference, payment_date)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            `).run(student.id, amount, method, transactionId, `fee_${feeId}`);

            db.prepare(`
                UPDATE fees
                SET paid_amount = ?, pending_amount = ?, status = ?
                WHERE id = ?
            `).run(nextPaid, nextPending, nextStatus, feeId);

            db.prepare(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                req.user.id,
                "PAYMENT",
                "fee",
                feeId,
                JSON.stringify({
                    fee_id: feeId,
                    amount,
                    method,
                    transaction_id: transactionId,
                    paid_at: new Date().toISOString()
                })
            );

            return res.status(201).json({
                status: "success",
                message: "Fee payment recorded successfully",
                payment: {
                    fee_id: feeId,
                    amount,
                    method,
                    transaction_id: transactionId,
                    remaining_balance: nextPending,
                    status: nextStatus
                }
            });

        } catch (error) {
            console.error("Student fee payment error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.get(
    "/api/student/bus",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const assignment = db.prepare(`
                SELECT
                    a.*,
                    b.bus_number,
                    b.route,
                    b.available AS bus_available,
                    s.stop_name,
                    s.pickup_time
                FROM student_bus_assignments a
                LEFT JOIN buses b ON b.id = a.bus_id
                LEFT JOIN bus_stops s ON s.id = a.stop_id
                JOIN students st ON st.id = a.student_id
                WHERE st.user_id = ?
                ORDER BY a.id DESC
                LIMIT 1
            `).get(req.user.id);

            return res.json({
                status: "success",
                assignment: assignment || null
            });

        } catch (error) {

            console.error("Student bus error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/assignments",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const searchSql = search ? "AND (a.title LIKE ? OR a.description LIKE ? OR s.name LIKE ?)" : "";
            const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];

            const assignments = db.prepare(`
                SELECT
                    a.id,
                    a.title,
                    a.description,
                    a.deadline AS due_date,
                    a.attachment_path AS attachment_url,
                    s.name AS subject_name,
                    sub.submitted_at,
                    sub.status AS submission_status,
                    sub.remarks
                FROM assignments a
                LEFT JOIN subjects s ON s.id = a.subject_id
                LEFT JOIN assignment_submissions sub
                    ON sub.assignment_id = a.id
                    AND sub.student_id = (SELECT id FROM students WHERE user_id = ?)
                WHERE s.id IS NULL
                   OR (s.department = (SELECT department FROM students WHERE user_id = ?)
                       AND (s.year IS NULL OR s.year = (SELECT year FROM students WHERE user_id = ?))
                       AND (s.section IS NULL OR s.section = (SELECT section FROM students WHERE user_id = ?)))
                ${searchSql}
                ORDER BY a.deadline, a.id DESC
                LIMIT ? OFFSET ?
            `).all(req.user.id, req.user.id, req.user.id, req.user.id, ...searchParams, limit, offset);

            return res.json({
                status: "success",
                assignments,
                pagination: { page, limit, returned: assignments.length }
            });

        } catch (error) {

            console.error("Student assignments error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/documents",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const searchSql = search ? "AND (title LIKE ? OR category LIKE ?)" : "";
            const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

            const documents = db.prepare(`
                SELECT
                    id,
                    title AS document_name,
                    category AS document_type,
                    file_path AS file_url,
                    created_at AS uploaded_at
                FROM documents
                     WHERE (visibility = 'Public'
                         OR student_id = (SELECT id FROM students WHERE user_id = ?))
                ${searchSql}
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
            `).all(req.user.id, ...searchParams, limit, offset);

            return res.json({
                status: "success",
                documents,
                pagination: { page, limit, returned: documents.length }
            });

        } catch (error) {

            console.error("Student documents error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/placements",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            const drives = db.prepare(`
                SELECT
                    d.*,
                    p.status AS application_status,
                    p.applied_at
                FROM placement_drives d
                LEFT JOIN placement_applications p
                    ON p.drive_id = d.id
                    AND p.student_id = ?
                WHERE d.status = 'Open'
                ORDER BY d.drive_date, d.id DESC
            `).all(student?.id || 0);

            return res.json({
                status: "success",
                drives
            });

        } catch (error) {

            console.error("Student placements error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/internships",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const internships = db.prepare(`
                SELECT *
                FROM internships
                WHERE status = 'Open'
                ORDER BY application_deadline, id DESC
            `).all();

            return res.json({
                status: "success",
                internships
            });

        } catch (error) {

            console.error("Student internships error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/materials",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT department, year, section
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const materials = db.prepare(`
                SELECT *
                FROM study_materials
                WHERE (department IS NULL OR department = ?)
                  AND (year IS NULL OR year = ?)
                  AND (section IS NULL OR section = ?)
                ORDER BY created_at DESC, id DESC
            `).all(student.department, student.year, student.section);

            return res.json({
                status: "success",
                materials
            });

        } catch (error) {

            console.error("Student materials error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/admin/materials",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const title = String(req.body.title || "").trim();
            const description = String(req.body.description || "").trim();
            const materialType = String(req.body.material_type || "Document").trim();
            const fileUrl = String(req.body.file_url || "").trim();
            const subject = String(req.body.subject || "").trim();
            const department = String(req.body.department || "").trim();
            const year = req.body.year ? Number(req.body.year) : null;
            const section = String(req.body.section || "").trim();

            if (!title) {
                return res.status(400).json({
                    status: "error",
                    message: "Material title is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO study_materials
                    (title, description, material_type, file_url, subject, department, year, section, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                title,
                description || null,
                materialType,
                fileUrl || null,
                subject || null,
                department || null,
                year,
                section || null,
                req.user.id
            );

            return res.status(201).json({
                status: "success",
                material_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Admin material create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/leave-requests",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const requests = db.prepare(`
                SELECT
                    lr.id,
                    lr.starts_on,
                    lr.ends_on,
                    lr.reason,
                    lr.status,
                    lr.reviewer_remarks,
                    lr.reviewer_remarks AS response,
                    lr.created_at
                FROM leave_requests lr
                JOIN students s ON s.id = lr.student_id
                WHERE s.user_id = ?
                ORDER BY lr.created_at DESC, lr.id DESC
            `).all(req.user.id);

            return res.json({
                status: "success",
                requests
            });

        } catch (error) {

            console.error("Student leave load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.post(
    "/api/student/leave-requests",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const startsOn = String(req.body.starts_on || "").trim();
            const endsOn = String(req.body.ends_on || "").trim();
            const reason = String(req.body.reason || "").trim();

            if (!startsOn || !endsOn || !reason) {
                return res.status(400).json({
                    status: "error",
                    message: "Start date, end date, and reason are required"
                });
            }

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const result = db.prepare(`
                INSERT INTO leave_requests (student_id, starts_on, ends_on, reason, status)
                VALUES (?, ?, ?, ?, 'Pending')
            `).run(student.id, startsOn, endsOn, reason);

            return res.status(201).json({
                status: "success",
                message: "Leave request submitted",
                request_id: result.lastInsertRowid
            });

        } catch (error) {

            console.error("Student leave create error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/admin/leave-requests",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const requests = db.prepare(`
                SELECT
                    lr.*,
                    s.full_name,
                    s.student_id AS student_code,
                    s.department,
                    s.year,
                    s.section
                FROM leave_requests lr
                LEFT JOIN students s ON s.id = lr.student_id
                ORDER BY lr.created_at DESC, lr.id DESC
            `).all();

            return res.json({
                status: "success",
                requests
            });

        } catch (error) {

            console.error("Admin leave load error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.patch(
    "/api/admin/leave-requests/:id/review",
    authenticateToken,
    requireAdmin,
    (req, res) => {

        try {

            const requestId = Number(req.params.id);
            const status = String(req.body.status || "").trim();
            const response = String(req.body.reviewer_remarks || req.body.response || "").trim();

            if (!['Approved', 'Rejected', 'Clarification'].includes(status)) {
                return res.status(400).json({
                    status: "error",
                    message: "Review status must be Approved, Rejected, or Clarification"
                });
            }

            const result = db.prepare(`
                UPDATE leave_requests
                SET status = ?, reviewer_remarks = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(status, response || null, req.user.id, requestId);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Leave request not found"
                });
            }

            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `).run(req.user.id, "REVIEW", "leave_request", requestId, JSON.stringify({ status }));

            return res.json({
                status: "success",
                message: `Leave request ${status.toLowerCase()}`
            });

        } catch (error) {

            console.error("Admin leave review error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/exams",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const results = db.prepare(`
                SELECT
                    m.id,
                    m.exam_type,
                    m.marks,
                    m.max_marks,
                    m.exam_date,
                    s.code AS subject_code,
                    s.name AS subject_name
                FROM marks m
                LEFT JOIN subjects s ON s.id = m.subject_id
                WHERE m.student_id = ?
                ORDER BY m.exam_date DESC, m.id DESC
            `).all(student.id);

            return res.json({
                status: "success",
                results
            });

        } catch (error) {

            console.error("Student exams error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/attendance",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const subjectWise = db.prepare(`
                SELECT
                    subject,
                    COUNT(*) AS conducted,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent
                FROM attendance
                WHERE student_id = ?
                GROUP BY subject
                ORDER BY subject
            `).all(student.id).map(item => ({
                ...item,
                percentage: item.conducted
                    ? Number(((item.present / item.conducted) * 100).toFixed(2))
                    : 0
            }));

            const summary = db.prepare(`
                SELECT
                    COUNT(*) AS conducted,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent
                FROM attendance
                WHERE student_id = ?
            `).get(student.id);

            return res.json({
                status: "success",
                summary: {
                    conducted: Number(summary.conducted || 0),
                    present: Number(summary.present || 0),
                    absent: Number(summary.absent || 0),
                    percentage: summary.conducted
                        ? Number(((summary.present / summary.conducted) * 100).toFixed(2))
                        : 0
                },
                subject_wise: subjectWise
            });

        } catch (error) {

            console.error("Student attendance error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);

app.get(
    "/api/student/marks",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);

            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const marks = db.prepare(`
                SELECT
                    m.id,
                    m.exam_type,
                    m.marks,
                    m.max_marks,
                    m.exam_date,
                    s.code AS subject_code,
                    s.name AS subject_name
                FROM marks m
                LEFT JOIN subjects s ON s.id = m.subject_id
                WHERE m.student_id = ?
                ORDER BY m.exam_date DESC, m.id DESC
                LIMIT ? OFFSET ?
            `).all(student.id, limit, offset);

            return res.json({
                status: "success",
                marks,
                pagination: { page, limit, returned: marks.length }
            });

        } catch (error) {

            console.error("Student marks error:", error);

            return res.status(500).json({
                status: "error",
                message: error.message
            });

        }
    }
);


// ============================================================
// STUDENT NOTIFICATIONS
// ============================================================

app.get(
    "/api/student/notifications",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const searchSql = search ? "AND (n.title LIKE ? OR n.message LIKE ?)" : "";
            const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const notifications = db.prepare(`
                SELECT
                    n.id,
                    n.title,
                    n.message,
                    n.audience,
                    n.branch,
                    n.year,
                    n.section,
                    n.created_at,
                    CASE
                        WHEN nr.id IS NOT NULL THEN 1
                        ELSE 0
                    END AS is_read
                FROM notifications n
                LEFT JOIN notification_reads nr
                    ON nr.notification_id = n.id
                    AND nr.student_id = ?
                WHERE (
                    n.audience = 'All'
                    OR n.audience = 'All Students'
                    OR (n.audience = 'Branch' AND n.branch = ?)
                    OR (n.audience = 'Year' AND n.year = ?)
                    OR (n.audience = 'Section' AND n.section = ?)
                    OR (n.audience = 'Branch + Year' AND n.branch = ? AND n.year = ?)
                    OR (n.audience = 'Branch + Section' AND n.branch = ? AND n.section = ?)
                    OR (n.audience = 'Year + Section' AND n.year = ? AND n.section = ?)
                )
                ${searchSql}
                ORDER BY n.created_at DESC
                LIMIT ? OFFSET ?
            `).all(
                student.id,
                student.department,
                student.year,
                student.section,
                student.department,
                student.year,
                student.department,
                student.section,
                student.year,
                student.section,
                ...searchParams,
                limit,
                offset
            );

            return res.json({
                status: "success",
                count: notifications.length,
                unread_count: notifications.filter((notification) => Number(notification.is_read) === 0).length,
                notifications,
                pagination: { page, limit, returned: notifications.length }
            });

        } catch (error) {
            console.error("Student notifications error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.get(
    "/api/student/notifications/unread-count",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const student = db.prepare(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const result = db.prepare(`
                SELECT COUNT(*) AS unread_count
                FROM notifications n
                LEFT JOIN notification_reads nr
                    ON nr.notification_id = n.id
                    AND nr.student_id = ?
                WHERE nr.id IS NULL
                  AND (
                    n.audience = 'All'
                    OR n.audience = 'All Students'
                    OR (n.audience = 'Branch' AND n.branch = ?)
                    OR (n.audience = 'Year' AND n.year = ?)
                    OR (n.audience = 'Section' AND n.section = ?)
                    OR (n.audience = 'Branch + Year' AND n.branch = ? AND n.year = ?)
                    OR (n.audience = 'Branch + Section' AND n.branch = ? AND n.section = ?)
                    OR (n.audience = 'Year + Section' AND n.year = ? AND n.section = ?)
                  )
            `).get(
                student.id,
                student.department,
                student.year,
                student.section,
                student.department,
                student.year,
                student.department,
                student.section,
                student.year,
                student.section
            );

            return res.json({
                status: "success",
                unread_count: Number(result.unread_count || 0)
            });

        } catch (error) {
            console.error("Unread Count Error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.patch(
    "/api/student/notifications/:id/read",
    authenticateToken,
    requireStudent,
    (req, res) => {

        try {

            const notificationId = Number(req.params.id);
            const student = db.prepare(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `).get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const existing = db.prepare(`
                SELECT id
                FROM notification_reads
                WHERE notification_id = ?
                  AND student_id = ?
            `).get(notificationId, student.id);

            if (!existing) {
                db.prepare(`
                    INSERT INTO notification_reads (notification_id, student_id)
                    VALUES (?, ?)
                `).run(notificationId, student.id);
            }

            return res.json({
                status: "success",
                message: "Notification marked as read"
            });

        } catch (error) {
            console.error("Mark notification read error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

// ============================================================
// ADMIN NOTIFICATIONS
// ============================================================

function getResultQueryFilters(req) {
    const department = String(req.query.department || "").trim();
    const year = String(req.query.year || "").trim();
    const semester = String(req.query.semester || "").trim();
    const section = String(req.query.section || "").trim();
    const academicYear = String(req.query.academic_year || "").trim();
    const subject = String(req.query.subject || "").trim();
    const resultStatus = String(req.query.result_status || "").trim();
    const publicationStatus = String(req.query.publication_status || "").trim();

    const filters = [];
    const params = [];

    if (department) { filters.push("r.department = ?"); params.push(department); }
    if (year) { filters.push("r.year = ?"); params.push(Number(year)); }
    if (semester) { filters.push("r.semester = ?"); params.push(Number(semester)); }
    if (section) { filters.push("r.section = ?"); params.push(section); }
    if (academicYear) { filters.push("r.academic_year = ?"); params.push(academicYear); }
    if (subject) { filters.push("(LOWER(r.subject) LIKE ? OR LOWER(r.subject_code) LIKE ?)"); params.push(`%${subject.toLowerCase()}%`, `%${subject.toLowerCase()}%`); }
    if (resultStatus) { filters.push("r.result_status = ?"); params.push(resultStatus); }
    if (publicationStatus) { filters.push("r.publication_status = ?"); params.push(publicationStatus); }

    return { filters, params };
}

app.get(
    "/api/admin/results/analytics",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const { filters, params } = getResultQueryFilters(req);
            const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

            const studentSummary = db.prepare(`
                WITH student_outcomes AS (
                    SELECT
                        r.student_id,
                        CASE
                            WHEN SUM(CASE WHEN r.pass_status = 'Fail' THEN 1 ELSE 0 END) = 0 THEN 'Pass'
                            ELSE 'Fail'
                        END AS overall_status
                    FROM result_records r
                    ${whereSql}
                    GROUP BY r.section, r.student_id
                )
                SELECT
                    COUNT(*) AS total_students,
                    COUNT(*) AS students_appeared,
                    COUNT(CASE WHEN overall_status = 'Pass' THEN 1 END) AS students_passed,
                    COUNT(CASE WHEN overall_status = 'Fail' THEN 1 END) AS students_failed
                FROM student_outcomes
            `).get(...params);

            const summary = db.prepare(`
                SELECT
                    COUNT(*) AS total_result_rows,
                    AVG(CASE WHEN total_marks IS NOT NULL THEN total_marks ELSE 0 END) AS average_percentage,
                    MAX(CASE WHEN total_marks IS NOT NULL THEN total_marks ELSE 0 END) AS highest_percentage,
                    MIN(CASE WHEN total_marks IS NOT NULL THEN total_marks ELSE 0 END) AS lowest_percentage,
                    AVG(CASE WHEN grade_point IS NOT NULL THEN grade_point ELSE 0 END) AS average_sgpa,
                    COUNT(DISTINCT CASE WHEN backlog_status IN ('Backlog', 'Arrear') THEN student_id || ':' || subject END) AS backlog_count
                FROM result_records r
                ${whereSql}
            `).get(...params);

            const sections = db.prepare(`
                WITH student_outcomes AS (
                    SELECT
                        r.section AS section,
                        r.student_id,
                        CASE
                            WHEN SUM(CASE WHEN r.pass_status = 'Fail' THEN 1 ELSE 0 END) = 0 THEN 'Pass'
                            ELSE 'Fail'
                        END AS overall_status,
                        AVG(CASE WHEN r.total_marks IS NOT NULL THEN r.total_marks ELSE 0 END) AS avg_marks,
                        AVG(CASE WHEN r.grade_point IS NOT NULL THEN r.grade_point ELSE 0 END) AS avg_sgpa
                    FROM result_records r
                    ${whereSql}
                    GROUP BY r.section, r.student_id
                )
                SELECT
                    section,
                    COUNT(DISTINCT student_id) AS students,
                    COUNT(DISTINCT CASE WHEN overall_status = 'Pass' THEN student_id END) AS passed,
                    COUNT(DISTINCT CASE WHEN overall_status = 'Fail' THEN student_id END) AS failed,
                    ROUND(AVG(avg_marks), 2) AS avg_percentage,
                    ROUND(AVG(avg_sgpa), 2) AS avg_sgpa
                FROM student_outcomes
                GROUP BY section
                ORDER BY section ASC
            `).all(...params);

            const subjectAnalytics = db.prepare(`
                SELECT
                    r.subject AS subject,
                    MIN(r.subject_code) AS subject_code,
                    COUNT(DISTINCT r.section || ':' || r.student_id) AS students_appeared,
                    COUNT(DISTINCT CASE WHEN r.pass_status = 'Pass' THEN r.section || ':' || r.student_id END) AS students_passed,
                    COUNT(DISTINCT CASE WHEN r.pass_status = 'Fail' THEN r.section || ':' || r.student_id END) AS students_failed,
                    ROUND(AVG(CASE WHEN r.total_marks IS NOT NULL THEN r.total_marks ELSE 0 END), 2) AS average_marks,
                    MAX(CASE WHEN r.total_marks IS NOT NULL THEN r.total_marks ELSE 0 END) AS highest_marks,
                    MIN(CASE WHEN r.total_marks IS NOT NULL THEN r.total_marks ELSE 0 END) AS lowest_marks
                FROM result_records r
                ${whereSql}
                GROUP BY r.subject
                ORDER BY r.subject ASC
            `).all(...params);

            const gradeDistribution = db.prepare(`
                SELECT
                    r.grade AS grade,
                    COUNT(*) AS count
                FROM result_records r
                ${whereSql}
                GROUP BY r.grade
                ORDER BY CASE r.grade
                    WHEN 'O' THEN 1
                    WHEN 'A+' THEN 2
                    WHEN 'A' THEN 3
                    WHEN 'B+' THEN 4
                    WHEN 'B' THEN 5
                    WHEN 'C' THEN 6
                    ELSE 7
                END
            `).all(...params);

            const departmentComparison = db.prepare(`
                WITH student_outcomes AS (
                    SELECT
                        r.department AS department,
                        r.student_id,
                        CASE
                            WHEN SUM(CASE WHEN r.pass_status = 'Fail' THEN 1 ELSE 0 END) = 0 THEN 'Pass'
                            ELSE 'Fail'
                        END AS overall_status,
                        AVG(CASE WHEN r.total_marks IS NOT NULL THEN r.total_marks ELSE 0 END) AS avg_marks,
                        AVG(CASE WHEN r.grade_point IS NOT NULL THEN r.grade_point ELSE 0 END) AS avg_sgpa
                    FROM result_records r
                    ${whereSql}
                    GROUP BY r.department, r.student_id
                )
                SELECT
                    department,
                    COUNT(DISTINCT student_id) AS students,
                    COUNT(DISTINCT CASE WHEN overall_status = 'Pass' THEN student_id END) AS passed,
                    COUNT(DISTINCT CASE WHEN overall_status = 'Fail' THEN student_id END) AS failed,
                    ROUND(AVG(avg_marks), 2) AS avg_percentage,
                    ROUND(AVG(avg_sgpa), 2) AS avg_sgpa
                FROM student_outcomes
                GROUP BY department
                ORDER BY department ASC
            `).all(...params);

            const summaryTotals = {
                total_students: Number(studentSummary.total_students || 0),
                students_appeared: Number(studentSummary.students_appeared || 0),
                students_passed: Number(studentSummary.students_passed || 0),
                students_failed: Number(studentSummary.students_failed || 0),
                average_percentage: Number(Number(summary.average_percentage || 0).toFixed(2)),
                highest_percentage: Number(Number(summary.highest_percentage || 0).toFixed(2)),
                lowest_percentage: Number(Number(summary.lowest_percentage || 0).toFixed(2)),
                average_sgpa: Number(Number(summary.average_sgpa || 0).toFixed(2)),
                backlog_count: Number(summary.backlog_count || 0)
            };

            const passPercentage = summaryTotals.students_appeared > 0
                ? ((summaryTotals.students_passed / summaryTotals.students_appeared) * 100)
                : 0;

            return res.json({
                status: "success",
                filters: {
                    department: req.query.department || "All",
                    year: req.query.year || "All",
                    semester: req.query.semester || "All",
                    section: req.query.section || "All",
                    academic_year: req.query.academic_year || "All"
                },
                summary: {
                    total_students: summaryTotals.total_students,
                    students_appeared: summaryTotals.students_appeared,
                    students_passed: summaryTotals.students_passed,
                    students_failed: summaryTotals.students_failed,
                    pass_percentage: Number(passPercentage.toFixed(2)),
                    fail_percentage: Number((100 - passPercentage).toFixed(2)),
                    average_percentage: summaryTotals.average_percentage,
                    highest_percentage: summaryTotals.highest_percentage,
                    lowest_percentage: summaryTotals.lowest_percentage,
                    average_sgpa: summaryTotals.average_sgpa,
                    backlog_count: summaryTotals.backlog_count
                },
                sections,
                subjectAnalytics,
                gradeDistribution,
                departmentComparison
            });
        } catch (error) {
            console.error("Result analytics error:", error);
            return res.status(500).json({ status: "error", message: error.message });
        }
    }
);

app.post(
    "/api/admin/results/import",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
            if (!rows.length) {
                return res.status(400).json({ status: "error", message: "No result rows provided for import" });
            }

            const imported = [];
            const stmt = db.prepare(`
                INSERT INTO result_records (
                    student_id, department, year, semester, section, academic_year,
                    subject, subject_code, internal_marks, external_marks, total_marks,
                    grade, grade_point, pass_status, backlog_status, result_status,
                    publication_status, reviewed_by, approved_by, published_by,
                    created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `);

            rows.forEach((row) => {
                const studentId = Number(row.student_id || row.studentId || 0);
                const department = String(row.department || "").trim();
                const year = Number(row.year || 1);
                const semester = Number(row.semester || 1);
                const section = String(row.section || "").trim();
                const academicYear = String(row.academic_year || row.academicYear || "2026-27").trim();
                const subject = String(row.subject || "").trim();
                const subjectCode = String(row.subject_code || row.subjectCode || "").trim();
                const internalMarks = Number(row.internal_marks ?? row.internalMarks ?? 0);
                const externalMarks = Number(row.external_marks ?? row.externalMarks ?? 0);
                const totalMarks = Number(row.total_marks ?? row.totalMarks ?? internalMarks + externalMarks);
                const grade = String(row.grade || getResultGrade(totalMarks)).trim();
                const gradePoint = Number(row.grade_point ?? row.gradePoint ?? getGradePoint(grade));
                const passStatus = String(row.pass_status || row.passStatus || (totalMarks >= 40 ? "Pass" : "Fail")).trim();
                const backlogStatus = String(row.backlog_status || row.backlogStatus || (passStatus === "Pass" ? "None" : "Backlog")).trim();
                const resultStatus = String(row.result_status || row.resultStatus || "Uploaded").trim();
                const publicationStatus = String(row.publication_status || row.publicationStatus || "Draft").trim();

                const result = stmt.run(
                    studentId,
                    department,
                    year,
                    semester,
                    section,
                    academicYear,
                    subject,
                    subjectCode,
                    internalMarks,
                    externalMarks,
                    totalMarks,
                    grade,
                    gradePoint,
                    passStatus,
                    backlogStatus,
                    resultStatus,
                    publicationStatus,
                    null,
                    null,
                    null,
                    req.user.id
                );
                imported.push({ id: result.lastInsertRowid, student_id: studentId, subject });
            });

            return res.status(201).json({ status: "success", message: `${imported.length} result rows imported`, imported });
        } catch (error) {
            console.error("Result import error:", error);
            return res.status(500).json({ status: "error", message: error.message });
        }
    }
);

app.patch(
    "/api/admin/results/:id/publish",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const resultId = Number(req.params.id);
            const target = db.prepare(`SELECT * FROM result_records WHERE id = ?`).get(resultId);
            if (!target) {
                return res.status(404).json({ status: "error", message: "Result record not found" });
            }

            db.prepare(`
                UPDATE result_records
                SET publication_status = 'Published',
                    published_by = ?,
                    published_at = CURRENT_TIMESTAMP,
                    result_status = 'Published',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(req.user.id, resultId);

            return res.json({ status: "success", message: "Results published to students" });
        } catch (error) {
            console.error("Result publish error:", error);
            return res.status(500).json({ status: "error", message: error.message });
        }
    }
);

app.get(
    "/api/student/results",
    authenticateToken,
    requireStudent,
    (req, res) => {
        try {
            const student = db.prepare(`SELECT id, student_id, full_name, department, year, section, academic_year FROM students WHERE user_id = ?`).get(req.user.id);
            if (!student) {
                return res.status(404).json({ status: "error", message: "Student record not found" });
            }

            const records = db.prepare(`
                SELECT *
                FROM result_records
                WHERE student_id = ?
                ORDER BY academic_year DESC, semester ASC, created_at DESC
            `).all(student.id);

            const published = records.filter((row) => row.publication_status === "Published");
            return res.json({
                status: "success",
                student,
                records,
                published,
                can_view_results: published.length > 0,
                message: published.length ? "Semester results published" : "Results are currently under review."
            });
        } catch (error) {
            console.error("Student results error:", error);
            return res.status(500).json({ status: "error", message: error.message });
        }
    }
);

app.get(
    "/api/admin/notifications",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const notifications = db.prepare(`
                SELECT *
                FROM notifications
                ORDER BY created_at DESC
            `).all();

            return res.json({
                status: "success",
                notifications
            });
        } catch (error) {
            console.error("Admin notifications load error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.post(
    "/api/admin/notifications",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const { title, message, audience, branch, year, section } = req.body;

            if (!title) {
                return res.status(400).json({
                    status: "error",
                    message: "Notification title is required"
                });
            }

            const result = db.prepare(`
                INSERT INTO notifications (title, message, audience, branch, year, section)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                title,
                message || "",
                audience || "All",
                branch || null,
                year ? Number(year) : null,
                section || null
            );

            return res.status(201).json({
                status: "success",
                message: "Notification published successfully",
                notification_id: result.lastInsertRowid
            });
        } catch (error) {
            console.error("Admin notifications create error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.delete(
    "/api/admin/notifications/:id",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        try {
            const id = Number(req.params.id);
            const result = db.prepare(`
                DELETE FROM notifications
                WHERE id = ?
            `).run(id);

            if (result.changes === 0) {
                return res.status(404).json({
                    status: "error",
                    message: "Notification not found"
                });
            }

            return res.json({
                status: "success",
                message: "Notification deleted successfully"
            });
        } catch (error) {
            console.error("Admin notifications delete error:", error);
            return res.status(500).json({
                status: "error",
                message: error.message
            });
        }
    }
);

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error.type === "entity.too.large" || error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
            status: "error",
            message: "Request or file is too large"
        });
    }

    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return res.status(400).json({
            status: "error",
            message: "Invalid JSON request"
        });
    }

    console.error("Unhandled request error:", error);
    return res.status(500).json({
        status: "error",
        message: "Internal server error"
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("\n==========================================");
    console.log(" KHIT FAMILY PORTAL SERVER");
    console.log("==========================================");
    console.log(` Server: http://localhost:${PORT}`);
    console.log(` API:    http://localhost:${PORT}/api/status`);
    console.log("==========================================\n");
});
