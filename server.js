// ============================================================
// KHIT FAMILY PORTAL
// Complete Backend Server
// Node.js + Express + SQLite
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const multer = require("multer");
const XLSX = require("xlsx");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const db = require("./database/database");
const postgres = require("./database/postgres-adapter");
const parentFamily = require("./database/parent-family");
const departmentHierarchy = require("./database/department-hierarchy");
const { createKhitAiService } = require("./khit-ai-service");
const { createStorageAdapter } = require("./storage/storage");

const app = express();

const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || null;
const ALLOWED_ADMIN_USERNAME = process.env.ADMIN_USERNAME || null;
const ALLOWED_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

if (!JWT_SECRET) {
    throw new Error("JWT_SECRET must be configured in the environment");
}

if (!ALLOWED_ADMIN_USERNAME || !ALLOWED_ADMIN_PASSWORD) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be configured in the environment");
}

const configuredUploadPath = process.env.UPLOAD_PATH || "./uploads";
const uploadDirectory = path.resolve(__dirname, configuredUploadPath);
const storageProvider = String(process.env.STORAGE_PROVIDER || process.env.UPLOAD_STORAGE || "local").toLowerCase();
const uploadPublicByDefault = process.env.UPLOAD_PUBLIC === "true" || (process.env.NODE_ENV !== "production" && process.env.UPLOAD_PUBLIC !== "false");
const uploadMaxMegabytes = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || 10);
const maxUploadBytes = Number.isFinite(uploadMaxMegabytes) && uploadMaxMegabytes > 0
    ? uploadMaxMegabytes * 1024 * 1024
    : 10 * 1024 * 1024;

if (!fs.existsSync(uploadDirectory)) {
    fs.mkdirSync(uploadDirectory, { recursive: true });
}

const storage = createStorageAdapter({
    rootDir: uploadDirectory,
    baseUrl: "/uploads",
    provider: storageProvider
});
const usesObjectStorage = ["s3", "object-storage", "cloud"].includes(storageProvider);

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

const blockedUploadExtensions = new Set([
    ".exe",
    ".bat",
    ".cmd",
    ".com",
    ".scr",
    ".js",
    ".jar",
    ".ps1",
    ".sh",
    ".php",
    ".html",
    ".htm",
    ".svg",
    ".msi",
    ".dll"
]);

const upload = multer({
    storage: multer.diskStorage({
        destination: uploadDirectory,
        filename: (req, file, callback) => {
            const extension = path.extname(file.originalname).toLowerCase();
            const baseName = path
                .basename(file.originalname, extension)
                .replace(/[^a-zA-Z0-9_-]/g, "-")
                .replace(/-+/g, "-")
                .slice(0, 60) || "upload";

            callback(null, storage.sanitizeFileName(`${baseName}${extension}`));
        }
    }),
    limits: {
        fileSize: maxUploadBytes
    },
    fileFilter: (req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const mimeType = String(file.mimetype || "").toLowerCase();
        const isAllowedExtension = allowedUploadExtensions.has(extension);
        const isBlockedExtension = blockedUploadExtensions.has(extension);
        const isAllowedMime = [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/csv",
            "image/png",
            "image/jpeg",
            "image/webp",
            "video/mp4",
            "application/octet-stream"
        ].includes(mimeType);

        if (isBlockedExtension || !isAllowedExtension || !isAllowedMime) {
            return callback(new Error("Unsupported or invalid upload type"));
        }

        callback(null, true);
    }
});


// ============================================================
// MIDDLEWARE
// ============================================================

const allowedOrigins = String(process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

if (isProduction && !allowedOrigins.length) {
    throw new Error("FRONTEND_URL must be configured in production");
}

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

app.use(cors({
    origin: allowedOrigins.length
        ? (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error("Origin is not allowed by CORS"));
        }
        : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

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

function isValidEmail(value) {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidMobile(value) {
    const normalized = String(value || "").trim();
    return /^\d{10,15}$/.test(normalized);
}

function isPositiveInteger(value, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= max;
}

function safeString(value, maxLength = 255) {
    if (value === undefined || value === null) return "";
    return String(value).trim().slice(0, maxLength);
}

const usePostgresRuntime = parentFamily.isPostgresConfigured();

async function runtimeGet(sql, params = []) {
    return usePostgresRuntime ? postgres.get(sql, params) : db.prepare(sql).get(...params);
}

async function runtimeAll(sql, params = []) {
    return usePostgresRuntime ? postgres.all(sql, params) : db.prepare(sql).all(...params);
}

async function runtimeRun(sql, params = []) {
    return usePostgresRuntime ? postgres.run(sql, params) : db.prepare(sql).run(...params);
}

function getLocalDevelopmentUser(sql, params = []) {
    return db.prepare(sql).get(...params);
}

function sanitizeAuditMetadata(metadata) {
    try {
        return JSON.stringify(metadata);
    } catch (_error) {
        return JSON.stringify({ sanitized: true });
    }
}

function sendServerError(res, statusCode, message, error) {
    if (error) {
        console.error(message, error);
    }
    return res.status(statusCode).json({ status: "error", message });
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

const loginRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 12,
    message: "Too many login attempts. Please wait before trying again."
});

const otpRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 8,
    message: "Too many OTP requests. Please wait before trying again."
});

const khitAiRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: "Too many KHIT AI requests. Please try again shortly."
});

const registrationRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 8,
    message: "Too many registrations from this network. Please try later."
});

app.use("/api", apiRateLimiter);
app.use("/api/login", loginRateLimiter);
app.use("/api/student/login", loginRateLimiter);
app.use("/api/faculty/login", loginRateLimiter);
app.use("/api/parent/login", loginRateLimiter);
app.use("/api/admin/login", loginRateLimiter);
app.use("/api/password-reset/request", otpRateLimiter);
app.use("/api/password-reset/confirm", otpRateLimiter);
app.use("/api/khit-ai/chat", khitAiRateLimiter);
app.use("/api/admin-password-reset/request", otpRateLimiter);
app.use("/api/admin-password-reset/confirm", otpRateLimiter);
app.use("/api/student/register", registrationRateLimiter);

if (uploadPublicByDefault && !usesObjectStorage) {
    app.use("/uploads", express.static(uploadDirectory, {
        index: false,
        redirect: false,
        dotfiles: "ignore"
    }));
}

// Inject the one shared assistant into every HTML page, including nested legacy pages.
app.use((req, res, next) => {
    if (req.method !== "GET" || !req.path.toLowerCase().endsWith(".html")) return next();

    const requestedPath = decodeURIComponent(req.path).replace(/^\/+/, "");
    const filePath = path.resolve(__dirname, requestedPath);
    if (!filePath.startsWith(__dirname) || !fs.existsSync(filePath)) return next();

    fs.readFile(filePath, "utf8", (error, html) => {
        if (error) return next();
        if (/<script\b[^>]+src=["'][^"']*khit-ai\.js(?:\?[^"']*)?["'][^>]*>/i.test(html)) {
            res.type("html").send(html);
            return;
        }
        const injectedHtml = html.replace(/<\/body>\s*<\/html>\s*$/i, '    <script src="/khit-ai.js"></script>\n</body>\n</html>');
        res.type("html").send(injectedHtml === html ? `${html}\n<script src="/khit-ai.js"></script>` : injectedHtml);
    });
});

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
    if (parentFamily.isPostgresConfigured()) {
        parentFamily.ensurePostgresParentFamilyTables().catch((error) => {
            console.error("PostgreSQL parent schema error:", error.message);
        });
        departmentHierarchy.ensurePostgresAuthorizationTables().catch((error) => {
            console.error("PostgreSQL authorization schema error:", error.message);
        });
    } else {
        parentFamily.ensureParentFamilyTables();
        parentFamily.migrateLegacyParentData();
    }
    departmentHierarchy.ensureDepartmentHierarchyTables();

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

    if (!isProduction) {
        ensureResultSeedData();
    }
    if (parentFamily.isPostgresConfigured() && !isProduction) {
        ensureDemoAccounts();
    } else if (!parentFamily.isPostgresConfigured() && !isProduction) {
        ensureDemoData().catch((error) => {
            console.error("SQLite demo data setup error:", error);
        });
    }

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
        if (parentFamily.isPostgresConfigured()) {
            await parentFamily.ensurePostgresParentFamilyTables();
            await departmentHierarchy.ensurePostgresAuthorizationTables();
        }
        const customAdminUser = await postgres.get(`
            SELECT id
            FROM users
            WHERE username = ?
        `, [ALLOWED_ADMIN_USERNAME]);

        if (!customAdminUser) {
            const customAdminPasswordHash = await bcrypt.hash(ALLOWED_ADMIN_PASSWORD, 10);
            await postgres.run(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'admin')
            `, [ALLOWED_ADMIN_USERNAME, customAdminPasswordHash]);
            console.log(`Custom admin account created for username: ${ALLOWED_ADMIN_USERNAME}`);
        }

        const defaultAdminUser = await postgres.get(`
            SELECT id
            FROM users
            WHERE username = ?
        `, ["admin"]);

        if (defaultAdminUser && ALLOWED_ADMIN_USERNAME !== "admin") {
            await postgres.run(`
                DELETE FROM users
                WHERE username = ?
            `, ["admin"]);
            console.log("Default demo admin removed to restrict access to the custom admin account.");
        }

        const studentUser = await postgres.get(`
            SELECT u.id, s.id AS student_record_id, s.student_id
            FROM users u
            LEFT JOIN students s ON s.user_id = u.id
            WHERE u.username = ?
        `, ["student"]);

        if (!studentUser) {
            const studentPasswordHash = await bcrypt.hash("student123", 10);
            const userResult = await postgres.run(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'student')
                RETURNING id
            `, ["student", studentPasswordHash]);
            const userId = userResult.lastInsertRowid ?? userResult.rows?.[0]?.id;

            await postgres.run(`
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
            `, [
                userId,
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
            ]);

            console.log("Demo student account created for username: student");
        } else if (!studentUser.student_record_id) {
            await postgres.run(`
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
            `, [
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
            ]);
        }

        const facultyUser = await postgres.get(`
            SELECT u.id, f.id AS faculty_record_id
            FROM users u
            LEFT JOIN faculty f ON f.user_id = u.id
            WHERE u.username = ?
        `, ["faculty"]);

        if (!facultyUser) {
            const facultyPasswordHash = await bcrypt.hash("faculty123", 10);
            const userResult = await postgres.run(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'faculty')
                RETURNING id
            `, ["faculty", facultyPasswordHash]);
            const userId = userResult.lastInsertRowid ?? userResult.rows?.[0]?.id;

            await postgres.run(`
                INSERT INTO faculty (faculty_id, full_name, department, designation, email, mobile, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                "FAC-1001",
                "Demo Faculty",
                "Computer Science",
                "Assistant Professor",
                "faculty@khit.edu.in",
                "9988776655",
                userId
            ]);

            console.log("Demo faculty account created for username: faculty");
        }

        const demoStudent = await postgres.get(`
            SELECT id
            FROM students
            WHERE student_id = ?
        `, ["STU-1001"]);

        if (demoStudent) {
            const feeCount = await postgres.get(`
                SELECT COUNT(*)::int AS count
                FROM fees
                WHERE student_id = ?
            `, [demoStudent.id]);

            if ((feeCount?.count || 0) === 0) {
                await postgres.run(`
                    INSERT INTO fees (student_id, academic_year, fee_year, total_amount, paid_amount, pending_amount, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [demoStudent.id, "2026-27", 2, 45000, 28000, 17000, "Partial"]);
            }

            const subjectCount = await postgres.get(`
                SELECT COUNT(*)::int AS count
                FROM subjects
            `);
            if ((subjectCount?.count || 0) === 0) {
                await postgres.run(`
                    INSERT INTO subjects (name, code, department, year, semester, section)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, ["Data Structures", "DS-101", "Computer Science", 2, 3, "A"]);
                await postgres.run(`
                    INSERT INTO subjects (name, code, department, year, semester, section)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, ["Database Management Systems", "DBMS-201", "Computer Science", 2, 3, "A"]);
                await postgres.run(`
                    INSERT INTO subjects (name, code, department, year, semester, section)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, ["Operating Systems", "OS-301", "Computer Science", 2, 3, "A"]);
            }

            const attendanceCount = await postgres.get(`
                SELECT COUNT(*)::int AS count
                FROM attendance
                WHERE student_id = ?
            `, [demoStudent.id]);

            if ((attendanceCount?.count || 0) === 0) {
                const subjects = await postgres.all(`
                    SELECT id, name
                    FROM subjects
                    ORDER BY id
                    LIMIT 3
                `);
                const dates = ["2026-09-02", "2026-09-04", "2026-09-06", "2026-09-09", "2026-09-11"];
                const statuses = ["Present", "Present", "Absent", "Present", "Leave"];

                for (let idx = 0; idx < dates.length; idx += 1) {
                    const subject = subjects[idx % subjects.length];
                    await postgres.run(`
                        INSERT INTO attendance (student_id, subject, attendance_date, status)
                        VALUES (?, ?, ?, ?)
                    `, [demoStudent.id, subject.name, dates[idx], statuses[idx]]);
                }
            }

            const marksCount = await postgres.get(`
                SELECT COUNT(*)::int AS count
                FROM marks
                WHERE student_id = ?
            `, [demoStudent.id]);

            if ((marksCount?.count || 0) === 0) {
                const subjects = await postgres.all(`
                    SELECT id, name
                    FROM subjects
                    ORDER BY id
                    LIMIT 3
                `);
                const sampleMarks = [
                    [subjects[0].id, "Midterm", 84, 100],
                    [subjects[1].id, "Quiz", 92, 100],
                    [subjects[2].id, "Assignment", 88, 100]
                ];

                for (const [subjectId, examType, marks, maxMarks] of sampleMarks) {
                    await postgres.run(`
                        INSERT INTO marks (student_id, subject_id, exam_type, marks, max_marks, exam_date)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [demoStudent.id, subjectId, examType, marks, maxMarks, "2026-09-15"]);
                }
            }

            const notificationCount = await postgres.get(`
                SELECT COUNT(*)::int AS count
                FROM notifications
            `);
            if ((notificationCount?.count || 0) === 0) {
                await postgres.run(`
                    INSERT INTO notifications (title, message, audience, is_read, created_at)
                    VALUES (?, ?, ?, ?, NOW())
                `, ["Welcome to KHIT Family", "Your student portal is ready. Please review your profile and fee updates.", "All", 0]);
                await postgres.run(`
                    INSERT INTO notifications (title, message, audience, is_read, created_at)
                    VALUES (?, ?, ?, ?, NOW())
                `, ["Mid-Semester Review", "Parents can now review attendance and marks from the dashboard.", "Parents", 0]);
            }
        }

        await ensureDemoData();
        await ensureDevelopmentParentFixture();
        await ensurePostgresManagementFixtures();
        await ensurePostgresDemoContent();
    } catch (error) {
        console.error("Demo account setup error:", error);
    }
}

async function ensurePostgresManagementFixtures() {
    if (!parentFamily.isPostgresConfigured() || isProduction) return;
    const managementPassword = process.env.MANAGEMENT_TEST_PASSWORD;
    if (!managementPassword) return;
    const passwordHash = await bcrypt.hash(managementPassword, 10);
    const fixtures = [
        ["dev-assistant-hod-ece", "assistant_hod", "ECE"],
        ["dev-associate-hod-ece", "associate_hod", "ECE"],
        ["dev-hod-ece", "hod", "ECE"],
        ["dev-ao", "ao", "CSE"],
        ["dev-principal", "principal", "CSE"],
        ["dev-director", "director", "CSE"],
        ["dev-admin", "admin", null],
        ["dev-superadmin", "superadmin", null],
        ["dev-pg-assistant-hod-ece", "assistant_hod", "ECE"],
        ["dev-pg-associate-hod-ece", "associate_hod", "ECE"],
        ["dev-pg-hod-ece", "hod", "ECE"],
        ["dev-pg-ao", "ao", "CSE"],
        ["dev-pg-principal", "principal", "CSE"],
        ["dev-pg-director", "director", "CSE"],
        ["dev-pg-admin", "admin", null],
        ["dev-pg-superadmin", "superadmin", null]
    ];
    for (const [username, role, departmentCode] of fixtures) {
        const user = await postgres.get(`
            INSERT INTO users (username, password, role, management_role)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, management_role = EXCLUDED.management_role
            RETURNING id
        `, [username, passwordHash, role, role]);
        if (departmentCode) {
            const department = await postgres.get("SELECT id FROM departments WHERE code = ?", [departmentCode]);
            const roleRow = await postgres.get("SELECT id FROM roles WHERE name = ?", [role]);
            if (department && roleRow) {
                await postgres.run(`
                    INSERT INTO user_departments (user_id, department_id, designation, role_name, is_primary)
                    VALUES (?, ?, ?, ?, TRUE)
                    ON CONFLICT (user_id, department_id, role_name) DO UPDATE SET is_primary = TRUE
                `, [user.id, department.id, role, role]);
                await postgres.run(`
                    INSERT INTO user_role_scopes (user_id, role_id, scope, department_id)
                    VALUES (?, ?, 'DEPARTMENT', ?)
                    ON CONFLICT (user_id, role_id, department_id) DO UPDATE SET scope = EXCLUDED.scope
                `, [user.id, roleRow.id, department.id]);
            }
        }
    }
}

async function ensurePostgresDemoContent() {
    if (!parentFamily.isPostgresConfigured() || isProduction) return;

    const notifications = [
        ["DEMO-28 Internal Assessment Schedule", "DEMO SAMPLE: Internal assessment schedule is available for portal demonstration.", "All Students", null, null, null],
        ["DEMO-28 Fee Payment Reminder", "DEMO SAMPLE: Please review the fee section for a sample pending-payment reminder.", "All Students", null, null, null]
    ];
    for (const [title, message, audience, branch, year, section] of notifications) {
        await postgres.run(`
            INSERT INTO notifications (title, message, audience, is_read, created_at, branch, year, section)
            SELECT ?, ?, ?, FALSE, CURRENT_TIMESTAMP, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE title = ?)
        `, [title, message, audience, branch, year, section, title]);
    }

    const events = [
        ["DEMO-28 ECE Technical Workshop", "DEMO SAMPLE: A practical workshop for demonstrating event visibility in the portal.", "2026-10-16", "10:00", "ECE Seminar Hall", "Workshop"],
        ["DEMO-28 Student Orientation", "DEMO SAMPLE: Orientation session used to demonstrate upcoming college events.", "2026-10-24", "09:30", "Main Auditorium", "Orientation"]
    ];
    for (const [title, description, eventDate, eventTime, venue, category] of events) {
        await postgres.run(`
            INSERT INTO events (title, description, event_date, event_time, venue, category, audience, published, created_at)
            SELECT ?, ?, ?, ?, ?, ?, 'All', TRUE, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = ?)
        `, [title, description, eventDate, eventTime, venue, category, title]);
    }

    const announcements = [
        ["DEMO-28 Academic Calendar Notice", "DEMO SAMPLE: Academic calendar information for portal demonstration.", "Academic"],
        ["DEMO-28 Student Activity Notice", "DEMO SAMPLE: Student activity announcement for testing authorized portal visibility.", "Activities"],
        ["DEMO-28 Examination Circular", "DEMO SAMPLE: Examination circular used for demonstrating official announcement responses.", "Examinations"]
    ];
    for (const [title, description, category] of announcements) {
        await postgres.run(`
            INSERT INTO announcements (title, description, audience, published, category, published_at, created_at)
            SELECT ?, ?, 'All Students', TRUE, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM announcements WHERE title = ?)
        `, [title, description, category, title]);
    }

    const materials = [
        ["DEMO-28 Digital Electronics Notes", "DEMO SAMPLE: Unit notes for ECE study-material demonstration.", "Document", "Digital Electronics", "ECE"],
        ["DEMO-28 Signals and Systems Guide", "DEMO SAMPLE: Revision guide for ECE study-material demonstration.", "Guide", "Signals and Systems", "ECE"],
        ["DEMO-28 Communication Systems Summary", "DEMO SAMPLE: Summary material for ECE portal testing.", "Summary", "Communication Systems", "ECE"]
    ];
    for (const [title, description, materialType, subject, department] of materials) {
        await postgres.run(`
            INSERT INTO study_materials (title, description, material_type, file_url, subject, department, year, section, created_at)
            SELECT ?, ?, ?, NULL, ?, ?, NULL, NULL, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM study_materials WHERE title = ?)
        `, [title, description, materialType, subject, department, title]);
    }

    const documents = [
        ["DEMO-28 Academic Calendar", "Academic Calendar", "/demo-documents/demo-28-academic-calendar.txt"],
        ["DEMO-28 Student Handbook", "Student Handbook", "/demo-documents/demo-28-student-handbook.txt"]
    ];
    for (const [title, category, fileUrl] of documents) {
        await postgres.run(`
            INSERT INTO documents (document_name, document_type, file_url, title, category, visibility, created_at)
            SELECT ?, ?, ?, ?, ?, 'Public', CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM documents WHERE title = ?)
        `, [title, category, fileUrl, title, category, title]);
        await postgres.run(`
            UPDATE documents
            SET document_type = ?, file_url = ?, category = ?, visibility = 'Public'
            WHERE title = ? AND title LIKE 'DEMO-28%'
        `, [category, fileUrl, category, title]);
    }
}

async function ensureDevelopmentParentFixture() {
    if (isProduction) return;

    const fixtureParent = await parentFamily.insertOrGetParentAsync({
        fullName: "Development Parent Fixture",
        mobile: "9000099991",
        email: "dev-parent-fixture@example.invalid"
    });
    if (!fixtureParent) return;

    const students = parentFamily.isPostgresConfigured()
        ? await postgres.all("SELECT id FROM students ORDER BY id LIMIT 2")
        : db.prepare("SELECT id FROM students ORDER BY id LIMIT 2").all();

    if (students.length < 2) return;
    await parentFamily.ensureParentLinkAsync(fixtureParent.id, students[0].id, "Father", 1);
    await parentFamily.ensureParentLinkAsync(fixtureParent.id, students[1].id, "Mother", 1);
}

async function ensureDemoData() {
    const userColumns = new Set(db.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
    if (!userColumns.has("management_role")) {
        db.exec("ALTER TABLE users ADD COLUMN management_role TEXT");
    }

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

    if (!isProduction && !parentFamily.isPostgresConfigured()) {
        const managementPassword = process.env.MANAGEMENT_TEST_PASSWORD;
        if (!managementPassword) return;
        const managementFixtures = [
            ["dev-assistant-hod-ece", "assistant_hod", "ECE"],
            ["dev-associate-hod-ece", "associate_hod", "ECE"],
            ["dev-hod-ece", "hod", "ECE"],
            ["dev-ao", "ao", "CSE"],
            ["dev-principal", "principal", "CSE"],
            ["dev-director", "director", "CSE"],
            ["dev-admin", "admin", null],
            ["dev-superadmin", "superadmin", null]
        ];
        const managementPasswordHash = await bcrypt.hash(managementPassword, 10);
        const insertManagementUser = db.prepare(`
            INSERT OR IGNORE INTO users (username, password, role)
            VALUES (?, ?, ?)
        `);
        const updateManagementUser = db.prepare("UPDATE users SET password = ?, role = ?, management_role = ? WHERE username = ?");
        for (const [username, role, departmentCode] of managementFixtures) {
            const storedRole = ["assistant_hod", "associate_hod", "ao", "principal", "director"].includes(role)
                ? "faculty"
                : role;
            insertManagementUser.run(username, managementPasswordHash, storedRole);
            updateManagementUser.run(managementPasswordHash, storedRole, role, username);

            const user = db.prepare("SELECT id, role, management_role FROM users WHERE username = ?").get(username);
            if (!user) continue;

            if (departmentCode) {
                const department = db.prepare("SELECT id FROM departments WHERE code = ?").get(departmentCode);
                if (department) {
                    await departmentHierarchy.upsertUserDepartmentAsync(user.id, department.id, role, role, 1, null, null);
                }
            } else {
                const roleScope = departmentHierarchy.getRoleScope(role);
                if (roleScope === "SYSTEM") {
                    db.prepare("DELETE FROM user_departments WHERE user_id = ?").run(user.id);
                }
            }
        }
    }

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

async function ensureManagementDepartmentMembership(user, requestedRole) {
    if (!user || !user.id) return null;

    const roleName = String(user.management_role || user.role || requestedRole || "").toLowerCase();
    const memberships = await departmentHierarchy.getUserDepartmentMembershipsAsync(user.id);
    if (memberships.length) {
        return memberships[0];
    }

    const username = String(user.username || "");
    const departmentToken = username.split(/[-_]/).filter(Boolean).slice(-1)[0] || "";
    const fallbackDepartment = departmentToken
        ? await departmentHierarchy.resolveDepartmentByNameOrCode(departmentToken.toUpperCase())
        : null;

    if (!fallbackDepartment || !["assistant_hod", "associate_hod", "hod", "ao", "principal", "director"].includes(roleName)) {
        return null;
    }

    const runtimeUserId = parentFamily.isPostgresConfigured()
        ? Number((await postgres.get("SELECT id FROM users WHERE username = ?", [username]))?.id || 0)
        : Number(user.id || 0);

    if (!runtimeUserId) {
        return null;
    }

    await departmentHierarchy.upsertUserDepartmentAsync(runtimeUserId, fallbackDepartment.id, roleName, roleName, 1, null, null);
    const repairedMemberships = await departmentHierarchy.getUserDepartmentMembershipsAsync(runtimeUserId);
    return repairedMemberships[0] || null;
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

function getAdminRoutePermission(req) {
    const path = req.path || "";
    const method = String(req.method || "GET").toUpperCase();
    const resourcePermissions = [
        ["/uploads", "documents.upload"],
        ["/students", method === "GET" ? "students.view" : "students.manage"],
        ["/faculty", method === "GET" ? "faculty.view" : "faculty.manage"],
        ["/fees", method === "GET" ? "fees.view" : "fees.manage"],
        ["/buses", method === "GET" ? "bus.view" : "bus.manage"],
        ["/events", method === "GET" ? "events.view" : "events.manage"],
        ["/announcements", "announcements.manage"],
        ["/stats", "reports.view"],
        ["/results", method === "GET" ? "results.view" : "results.manage"],
        ["/attendance", method === "GET" ? "attendance.view" : "attendance.manage"],
        ["/assignments", method === "GET" ? "assignments.view" : "assignments.create"],
        ["/documents", method === "GET" ? "documents.view" : "documents.manage"],
        ["/materials", method === "GET" ? "study_materials.view" : "study_materials.manage"],
        ["/leave-requests", method === "GET" ? "leave.view" : "leave.approve"],
        ["/reports/export", "reports.export"],
        ["/reports", "reports.view"],
        ["/notifications", method === "GET" ? "notifications.view" : "notifications.manage"],
        ["/settings", method === "GET" ? "settings.view" : "settings.manage"],
        ["/users", method === "GET" ? "users.view" : "users.manage"],
        ["/roles", "roles.manage"],
        ["/system", "system.manage"],
        ["/audit", "audit.view"]
    ];
    const match = resourcePermissions.find(([prefix]) => path.startsWith(`/api/admin${prefix}`));
    const departmentPermissions = {
        students: "department.student.read",
        faculty: "department.faculty.read",
        results: "department.results.read"
    };
    const role = String(req.user?.role || "").toLowerCase();
    if (["faculty", "assistant_hod", "associate_hod", "hod"].includes(role)) {
        const departmentMatch = Object.entries(departmentPermissions).find(([resource]) => path.startsWith(`/api/admin/${resource}`));
        if (departmentMatch) return departmentMatch[1];
        return null;
    }
    return match ? match[1] : null;
}

function requirePermission(permission) {
    return function permissionMiddleware(req, res, next) {
        if (!req.user) {
            return res.status(401).json({ status: "error", message: "Authentication required" });
        }
        if (!departmentHierarchy.hasRolePermission(req.user, permission)) {
            return res.status(403).json({ status: "error", message: "Permission denied" });
        }
        next();
    };
}

async function requireAdmin(req, res, next) {

    if (!req.user) {

        return res.status(401).json({
            status: "error",
            message: "Authentication required"
        });

    }

    const managementRoles = ["faculty", "assistant_hod", "associate_hod", "hod", "ao", "principal", "director"];
    if (!managementRoles.includes(req.user.role) && req.user.role !== "admin" && req.user.role !== "superadmin") {

        return res.status(403).json({
            status: "error",
            message: "Admin access required"
        });

    }

    const requiredPermission = getAdminRoutePermission(req);
    if (!requiredPermission) {
        return res.status(403).json({ status: "error", message: "Endpoint permission is not configured" });
    }
    if (!departmentHierarchy.hasRolePermission(req.user, requiredPermission)) {
        return res.status(403).json({ status: "error", message: "Permission denied" });
    }

    if (String(req.user.scope || departmentHierarchy.getRoleScope(req.user.role)).toUpperCase() === "DEPARTMENT") {
        const requestedDepartmentId = Number(req.params.department_id || req.query.department_id || req.body?.department_id || 0);
        const requestedDepartment = requestedDepartmentId
            ? (parentFamily.isPostgresConfigured()
                ? await postgres.get("SELECT * FROM departments WHERE id = ?", [requestedDepartmentId])
                : db.prepare("SELECT * FROM departments WHERE id = ? AND active = 1").get(requestedDepartmentId))
            : (parentFamily.isPostgresConfigured()
                ? await postgres.get(`
                    SELECT * FROM departments
                    WHERE code = ? OR name = ?
                    ORDER BY id ASC
                    LIMIT 1
                `, [req.query.department || req.body?.department || "", req.query.department || req.body?.department || ""])
                : departmentHierarchy.resolveDepartmentByNameOrCode(req.query.department || req.body?.department || ""));
        if (!requestedDepartment || !departmentHierarchy.canAccessDepartment(req.user, requestedDepartment.id, requiredPermission)) {
            return res.status(403).json({ status: "error", message: "Department access denied" });
        }
        req.query.department = requestedDepartment.code;
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

    if (req.user.scope && req.user.scope !== "STUDENT_LINKED") {
        return res.status(403).json({
            status: "error",
            message: "Parent access scope is invalid"
        });
    }

    next();

}

function requireParentScope(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    if (req.user.role !== "parent" || (req.user.scope && req.user.scope !== "STUDENT_LINKED")) {
        return res.status(403).json({ status: "error", message: "Linked student scope required" });
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

function requireDepartmentAccess(requiredPermission = null) {
    return function departmentAccessMiddleware(req, res, next) {
        if (!req.user) {
            return res.status(401).json({ status: "error", message: "Authentication required" });
        }

        if (req.user.role === "admin" || req.user.role === "superadmin") {
            return next();
        }

        const userScope = String(req.user.scope || departmentHierarchy.getRoleScope(req.user.role || "") || "").toUpperCase();
        if (userScope === "COLLEGE_WIDE" || userScope === "SYSTEM") {
            if (requiredPermission && !departmentHierarchy.hasRolePermission(req.user, requiredPermission)) {
                return res.status(403).json({ status: "error", message: "Permission denied for college-wide scope" });
            }
            return next();
        }

        const departmentId = Number(req.params.department_id || req.query.department_id || req.body?.department_id || req.user.department_id || 0);
        if (!departmentId) {
            return res.status(403).json({ status: "error", message: "Department context is required" });
        }

        const userRole = String(req.user.role || "").toLowerCase();
        const allowed = departmentHierarchy.canAccessDepartment({ ...req.user, role: userRole }, departmentId, requiredPermission);

        if (!allowed) {
            return res.status(403).json({ status: "error", message: "Department access denied" });
        }

        next();
    };
}

function requireManagementAccess({ departmentPermission = null, collegePermission = null, roles = null } = {}) {
    return function managementAccessMiddleware(req, res, next) {
        if (!req.user) {
            return res.status(401).json({ status: "error", message: "Authentication required" });
        }

        const managementRoles = roles || ["faculty", "assistant_hod", "associate_hod", "hod", "ao", "principal", "director", "admin", "superadmin"];
        if (!managementRoles.includes(String(req.user.role || "").toLowerCase())) {
            return res.status(403).json({ status: "error", message: "Management access required" });
        }

        const scope = String(req.user.scope || departmentHierarchy.getRoleScope(req.user.role) || "").toUpperCase();
        const permission = scope === "DEPARTMENT" ? departmentPermission : collegePermission;
        if (permission && !departmentHierarchy.hasRolePermission(req.user, permission)) {
            return res.status(403).json({ status: "error", message: "Permission denied" });
        }

        if (scope === "DEPARTMENT") {
            const requestedDepartmentId = Number(req.params.department_id || req.query.department_id || req.body?.department_id || req.user.department_id || 0);
            if (parentFamily.isPostgresConfigured()) {
                if (!requestedDepartmentId || Number(req.user.department_id) !== requestedDepartmentId) {
                    return res.status(403).json({ status: "error", message: "Department access denied" });
                }
                req.managementDepartmentId = requestedDepartmentId;
                return next();
            }
            if (!requestedDepartmentId || !departmentHierarchy.canAccessDepartment(req.user, requestedDepartmentId, permission)) {
                return res.status(403).json({ status: "error", message: "Department access denied" });
            }
            req.managementDepartmentId = requestedDepartmentId;
        } else if (!["COLLEGE_WIDE", "SYSTEM"].includes(scope)) {
            return res.status(403).json({ status: "error", message: "Management scope is invalid" });
        }

        next();
    };
}

function getManagementDepartment(req) {
    if (parentFamily.isPostgresConfigured() && req.user?.department_id) {
        return {
            id: req.user.department_id,
            code: req.user.department_code,
            name: req.user.department_name
        };
    }
    if (req.managementDepartmentId) {
        return db.prepare("SELECT * FROM departments WHERE id = ? AND active = 1").get(req.managementDepartmentId);
    }
    return null;
}

const khitAiService = createKhitAiService({
    db,
    postgres,
    parentFamily,
    departmentHierarchy
});

async function recordKhitAiAudit(userId, intent, success) {
    if (!userId) return;
    const metadata = JSON.stringify({ intent: intent || "unknown", success: Boolean(success) });
    try {
        if (parentFamily.isPostgresConfigured()) {
            await postgres.run(`
                INSERT INTO audit_logs (user_id, action, entity_type, metadata)
                VALUES (?, ?, ?, ?)
            `, [userId, "KHIT_AI_QUERY", "khit_ai", metadata]);
        } else {
            db.prepare(`
                INSERT INTO audit_logs (user_id, action, entity_type, metadata)
                VALUES (?, ?, ?, ?)
            `).run(userId, "KHIT_AI_QUERY", "khit_ai", metadata);
        }
    } catch (error) {
        console.error("KHIT AI audit error:", error.message);
    }
}

app.post(
    "/api/khit-ai/chat",
    authenticateToken,
    async (req, res) => {
        const payload = req.body && typeof req.body === "object" ? req.body : {};
        const rawMessage = String(payload.message || "").trim();
        if (rawMessage.length > 1000) {
            return res.status(400).json({
                success: false,
                status: "error",
                message: "Question is too long. Please keep it under 1000 characters."
            });
        }
        const message = khitAiService.normalizeMessage(rawMessage);
        const requestedStudentId = payload.student_id;

        if (!message) {
            return res.status(400).json({
                success: false,
                status: "error",
                message: "A question is required."
            });
        }

        try {
            const result = await khitAiService.handle({
                user: req.user,
                message,
                studentId: requestedStudentId
            });
            const success = !result.error;
            await recordKhitAiAudit(req.user.id, result.intent, success);

            if (result.error) {
                return res.status(result.status || 403).json({
                    success: false,
                    status: "error",
                    intent: result.intent || "unknown",
                    message: result.error
                });
            }

            return res.json({
                success: true,
                status: "success",
                intent: result.intent || "unknown",
                message: result.message,
                data: result.data || null
            });
        } catch (error) {
            await recordKhitAiAudit(req.user.id, "unknown", false);
            console.error("KHIT AI request error:", error.message);
            return res.status(500).json({
                success: false,
                status: "error",
                message: "KHIT AI is temporarily unavailable."
            });
        }
    }
);


// ============================================================
// ADMIN FILE UPLOADS
// ============================================================

app.post(
    "/api/admin/uploads",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        upload.single("file")(req, res, async error => {

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

            const storedFile = await storage.uploadFile(
                req.file.path,
                usesObjectStorage ? `uploads/${req.file.filename}` : req.file.filename,
                req.file.mimetype
            );
            if (usesObjectStorage) fs.unlinkSync(req.file.path);
            const fileUrl = storedFile.url;

            await runtimeRun(`
                INSERT INTO audit_logs (user_id, action, entity_type, metadata)
                VALUES (?, ?, ?, ?)
            `, [
                req.user.id,
                "UPLOAD",
                "file",
                JSON.stringify({
                    originalName: req.file.originalname,
                    fileUrl,
                    size: req.file.size,
                    mimeType: req.file.mimetype
                })
            ]);

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
    async (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const where = search
                ? "WHERE d.title LIKE ? OR d.category LIKE ?"
                : "";
            const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

            const documents = await runtimeAll(`
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
            `, [...searchParams, limit, offset]);
            const total = await runtimeGet(`
                SELECT COUNT(*) AS total FROM documents d ${where}
            `, searchParams);

            return res.json({
                status: "success",
                documents,
                pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
            });

        } catch (error) {

            console.error("Admin documents load error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load documents"
            });

        }
    }
);

app.post(
    "/api/admin/documents",
    authenticateToken,
    requireAdmin,
    (req, res) => {
        upload.single("file")(req, res, async error => {

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
                ? (await runtimeGet("SELECT id FROM students WHERE user_id = ?", [requestedUserId]) || {}).id
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
                const student = await runtimeGet("SELECT id FROM students WHERE id = ?", [studentId]);
                if (!student) {
                    fs.unlinkSync(req.file.path);
                    return res.status(404).json({
                        status: "error",
                        message: "Target student not found"
                    });
                }
            }

            try {

                const storedFile = await storage.uploadFile(
                    req.file.path,
                    usesObjectStorage ? `documents/${req.file.filename}` : req.file.filename,
                    req.file.mimetype
                );
                const fileUrl = storedFile.url;
                const result = await runtimeRun(`
                    INSERT INTO documents
                        (student_id, title, category, file_path, uploaded_by, visibility, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    RETURNING id
                `, [studentId, documentName, documentType, fileUrl, req.user.id, visibility]);

                await runtimeRun(`
                    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    req.user.id,
                    "UPLOAD",
                    "document",
                    result.lastInsertRowid,
                    JSON.stringify({ documentName, documentType, studentId, visibility, fileUrl, storageKey: storedFile.key })
                ]);

                if (usesObjectStorage) fs.unlinkSync(req.file.path);

                const documentId = result.lastInsertRowid ?? result.rows?.[0]?.id;

                return res.status(201).json({
                    status: "success",
                    message: "Document uploaded",
                    document_id: documentId,
                    file_url: fileUrl
                });

            } catch (databaseError) {
                if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                console.error("Admin document save error:", databaseError);
                return res.status(500).json({
                    status: "error",
                    message: "Unable to save document"
                });
            }
        });
    }
);

app.delete(
    "/api/admin/documents/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const documentId = Number(req.params.id);
            const document = await runtimeGet(`
                SELECT file_path
                FROM documents
                WHERE id = ?
            `, [documentId]);

            if (!document) {
                return res.status(404).json({ status: "error", message: "Document not found" });
            }

            const result = await runtimeRun("DELETE FROM documents WHERE id = ?", [documentId]);
            if (result.changes && document.file_path) {
                if (usesObjectStorage) await storage.deleteObject(document.file_path.replace(/^\/api\/files\//, ""));
                else storage.deleteObject(document.file_path);
            }

            return res.json({ status: "success", message: "Document deleted" });
        } catch (error) {
            console.error("Admin document delete error:", error);
            return res.status(500).json({ status: "error", message: "Unable to delete document" });
        }
    }
);

app.get(/^\/api\/files\/(.+)$/, authenticateToken, async (req, res) => {
    try {
        const requestedKey = decodeURIComponent(req.params[0] || "");
        if (!requestedKey || requestedKey.includes("..")) return res.status(404).json({ status: "error", message: "File not found" });
        const document = await runtimeGet(`
            SELECT d.id, d.file_path, d.visibility, d.student_id, d.uploaded_by,
                   s.user_id AS student_user_id
            FROM documents d
            LEFT JOIN students s ON s.id = d.student_id
            WHERE d.file_path = ? OR d.file_path = ?
            LIMIT 1
        `, [`/api/files/${requestedKey}`, `/uploads/${requestedKey}`]);
        if (!document && requestedKey.startsWith("uploads/") && ["admin", "superadmin"].includes(String(req.user.role || "").toLowerCase())) {
            const servedUpload = await storage.getDownloadResponse(requestedKey, res);
            return servedUpload ? undefined : res.status(404).json({ status: "error", message: "File not found" });
        }
        if (!document) return res.status(404).json({ status: "error", message: "File not found" });

        const role = String(req.user.role || "").toLowerCase();
        const allowed = document.visibility === "Public"
            || ["admin", "superadmin"].includes(role)
            || Number(document.uploaded_by) === Number(req.user.id)
            || (role === "student" && Number(document.student_user_id) === Number(req.user.id))
            || (role === "parent" && await parentFamily.isStudentLinkedToParentAsync(req.user.parent_id || req.user.id, document.student_id));
        if (!allowed) return res.status(403).json({ status: "error", message: "File access denied" });

        const served = await storage.getDownloadResponse(requestedKey, res);
        if (!served) return res.status(404).json({ status: "error", message: "File not found" });
    } catch (error) {
        console.error("File download error:", error.message);
        return res.status(500).json({ status: "error", message: "Unable to download file" });
    }
});

// ============================================================
// APP SETTINGS
// ============================================================

app.get(
    "/api/admin/settings",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const rows = await runtimeAll(`
                SELECT setting_key, setting_value, description, updated_at
                FROM app_settings
                ORDER BY setting_key ASC
            `);

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
                message: "Unable to load settings"
            });
        }
    }
);

app.put(
    "/api/admin/settings",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
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

            await (usePostgresRuntime
                ? postgres.transaction(async transaction => {
                    for (const { key, value } of rowsToUpdate) {
                        await transaction.run(`
                            INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at)
                            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                            ON CONFLICT(setting_key) DO UPDATE SET
                                setting_value = EXCLUDED.setting_value,
                                updated_by = EXCLUDED.updated_by,
                                updated_at = CURRENT_TIMESTAMP
                        `, [key, value, req.user.id]);
                    }
                })
                : Promise.all(rowsToUpdate.map(({ key, value }) => runtimeRun(`
                    INSERT INTO app_settings (setting_key, setting_value, updated_by, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(setting_key) DO UPDATE SET
                        setting_value = excluded.setting_value,
                        updated_by = excluded.updated_by,
                        updated_at = CURRENT_TIMESTAMP
                `, [key, value, req.user.id]))));

            const updatedSettings = await runtimeAll(`
                SELECT setting_key, setting_value
                FROM app_settings
                WHERE setting_key IN (${rowsToUpdate.map(() => "?").join(", ")})
            `, rowsToUpdate.map(({ key }) => key));

            const responseSettings = {};
            updatedSettings.forEach((row) => {
                responseSettings[row.setting_key] = row.setting_value === "true";
            });

            await runtimeRun(`
                INSERT INTO audit_logs (user_id, action, entity_type, metadata)
                VALUES (?, ?, ?, ?)
            `, [
                req.user.id,
                "UPDATE_SETTINGS",
                "app_settings",
                JSON.stringify({ updates: responseSettings })
            ]);

            return res.json({
                status: "success",
                message: "Settings updated successfully",
                settings: responseSettings
            });

        } catch (error) {
            console.error("Admin settings update error:", error);
            return res.status(500).json({
                status: "error",
                message: "Unable to update settings"
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

app.get("/api/health", async (req, res) => {
    try {
        if (parentFamily.isPostgresConfigured()) {
            await postgres.get("SELECT 1 AS ok");
        } else {
            db.prepare("SELECT 1 AS ok").get();
        }
        return res.json({ status: "ok", database: "ready" });
    } catch (error) {
        console.error("Health check failed:", error);
        return res.status(503).json({ status: "error", database: "unavailable" });
    }
});

app.get("/api/demo-credentials", async (req, res) => {
    try {
        if (isProduction) {
            return res.status(404).json({
                status: "error",
                message: "Demo credentials are unavailable in production"
            });
        }
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
                },
                management: isProduction ? null : {
                    password_source: "MANAGEMENT_TEST_PASSWORD",
                    department_roles: {
                        assistant_hod: "dev-assistant-hod-ece",
                        associate_hod: "dev-associate-hod-ece",
                        hod: "dev-hod-ece"
                    },
                    college_roles: {
                        ao: "dev-ao",
                        principal: "dev-principal",
                        director: "dev-director"
                    },
                    administration: {
                        admin: "dev-admin",
                        superadmin: "dev-superadmin"
                    }
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
        const username = safeString(req.body.username).slice(0, 80);
        const email = safeString(req.body.email).toLowerCase();
        const transport = getMailTransport();

        if (!username || !email || !isValidEmail(email)) {
            return res.status(400).json({
                status: "error",
                message: "Username and a valid registered email are required"
            });
        }

        if (!transport) {
            return res.status(503).json({
                status: "error",
                message: "Password reset email is not configured yet"
            });
        }

        const user = await postgres.get(`
            SELECT u.id, u.username, s.email, s.full_name
            FROM users u
            JOIN students s ON s.user_id = u.id
            WHERE u.username = ? AND u.role = 'student' AND lower(s.email) = ?
        `, [username, email]);

        if (!user) {
            return res.status(400).json({
                status: "error",
                message: "Username and registered email do not match"
            });
        }

        const otp = createPasswordResetOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await postgres.transaction(async transaction => {
            await transaction.run(`
                UPDATE password_reset_otps
                SET used_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND used_at IS NULL
            `, [user.id]);

            await transaction.run(`
                INSERT INTO password_reset_otps (user_id, otp_hash, expires_at)
                VALUES (?, ?, ?)
            `, [user.id, otpHash, expiresAt]);
        });

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
        const username = safeString(req.body.username).slice(0, 80);
        const email = safeString(req.body.email).toLowerCase();
        const otp = safeString(req.body.otp).replace(/\D/g, "").slice(0, 6);
        const newPassword = String(req.body.newPassword || "");

        if (!username || !email || !isValidEmail(email) || !otp || otp.length !== 6 || newPassword.length < 8) {
            return res.status(400).json({
                status: "error",
                message: "Username, valid email, 6-digit OTP, and an 8-character password are required"
            });
        }

        const user = await postgres.get(`
            SELECT u.id
            FROM users u
            JOIN students s ON s.user_id = u.id
            WHERE u.username = ? AND u.role = 'student' AND lower(s.email) = ?
        `, [username, email]);

        const reset = user && await postgres.get(`
            SELECT *
            FROM password_reset_otps
            WHERE user_id = ? AND used_at IS NULL
            ORDER BY id DESC
            LIMIT 1
        `, [user.id]);

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
        await postgres.transaction(async transaction => {
            await transaction.run("UPDATE users SET password = ? WHERE id = ?", [passwordHash, user.id]);
            await transaction.run("UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?", [reset.id]);
        });

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
        const username = safeString(req.body.username).slice(0, 80);
        const email = safeString(req.body.email).toLowerCase();
        const configuredEmail = String(process.env.ADMIN_RESET_EMAIL || "").trim().toLowerCase();
        const transport = getMailTransport();

        if (!username || !email || !isValidEmail(email)) {
            return res.status(400).json({ status: "error", message: "Admin username and a valid reset email are required" });
        }

        if (!transport || !configuredEmail) {
            return res.status(503).json({ status: "error", message: "Admin password reset email is not configured yet" });
        }

        const user = await postgres.get(`
            SELECT id, username
            FROM users
            WHERE username = ? AND role IN ('admin', 'superadmin')
        `, [username]);

        if (!user || email !== configuredEmail) {
            return res.status(400).json({ status: "error", message: "Admin username and reset email do not match" });
        }

        const otp = createPasswordResetOtp();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await postgres.transaction(async transaction => {
            await transaction.run(`
                UPDATE password_reset_otps
                SET used_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND used_at IS NULL
            `, [user.id]);
            await transaction.run(`
                INSERT INTO password_reset_otps (user_id, otp_hash, expires_at)
                VALUES (?, ?, ?)
            `, [user.id, otpHash, expiresAt]);
        });

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
        const username = safeString(req.body.username).slice(0, 80);
        const email = safeString(req.body.email).toLowerCase();
        const otp = safeString(req.body.otp).replace(/\D/g, "").slice(0, 6);
        const newPassword = String(req.body.newPassword || "");
        const configuredEmail = String(process.env.ADMIN_RESET_EMAIL || "").trim().toLowerCase();

        if (!username || email !== configuredEmail || !otp || otp.length !== 6 || newPassword.length < 8) {
            return res.status(400).json({ status: "error", message: "Valid admin email, 6-digit OTP, and an 8-character password are required" });
        }

        const user = await postgres.get(`
            SELECT id
            FROM users
            WHERE username = ? AND role IN ('admin', 'superadmin')
        `, [username]);
        const reset = user && await postgres.get(`
            SELECT * FROM password_reset_otps
            WHERE user_id = ? AND used_at IS NULL
            ORDER BY id DESC LIMIT 1
        `, [user.id]);

        if (!reset || new Date(reset.expires_at).getTime() < Date.now() || !(await bcrypt.compare(otp, reset.otp_hash))) {
            return res.status(400).json({ status: "error", message: "OTP is invalid or expired" });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await postgres.transaction(async transaction => {
            await transaction.run("UPDATE users SET password = ? WHERE id = ?", [passwordHash, user.id]);
            await transaction.run("UPDATE password_reset_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?", [reset.id]);
        });

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

            const requestedRole = safeString(role).trim().toLowerCase();
            const normalizedUsername = safeString(username).slice(0, 80);
            const normalizedPassword = String(password || "");
            const normalizedStudentId = safeString(studentId).slice(0, 80);
            const normalizedParentMobile = safeString(parentMobile).slice(0, 30);
            const normalizedParentEmail = safeString(parentEmail).toLowerCase().slice(0, 255);

            if (requestedRole === "parent" || studentId) {
                return res.status(410).json({
                    status: "error",
                    message: "Parent login requires OTP verification. Use /api/parent/request-otp and /api/parent/verify-otp."
                });
            }

            if (!normalizedUsername || !normalizedPassword) {
                return res.status(400).json({
                    status: "error",
                    message: "Username and password are required"
                });
            }

            if (requestedRole === "admin" || requestedRole === "superadmin") {
                const isDevelopmentFixture = !isProduction && normalizedUsername.startsWith("dev-");
                if (normalizedUsername !== ALLOWED_ADMIN_USERNAME && !isDevelopmentFixture) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                let user = await postgres.get(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role IN ('admin', 'superadmin')
                `, [normalizedUsername]);

                if (!user && isDevelopmentFixture) {
                    user = getLocalDevelopmentUser(`
                        SELECT * FROM users
                        WHERE username = ? AND role IN ('admin', 'superadmin')
                    `, [normalizedUsername]);
                }

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

            const managementRoles = ["assistant_hod", "associate_hod", "hod", "ao", "principal", "director"];
            if (managementRoles.includes(requestedRole)) {
                let user = null;
                try {
                    user = await postgres.get(`
                        SELECT * FROM users
                        WHERE username = ? AND (role = ? OR management_role = ?)
                    `, [normalizedUsername, requestedRole, requestedRole]);
                } catch (error) {
                    if (isProduction || !normalizedUsername.startsWith("dev-")) throw error;
                }
                if (!user && !isProduction && normalizedUsername.startsWith("dev-")) {
                    user = getLocalDevelopmentUser(`
                        SELECT *, COALESCE(management_role, role) AS resolved_role
                        FROM users
                        WHERE username = ? AND (role = ? OR management_role = ?)
                    `, [normalizedUsername, requestedRole, requestedRole]);
                }
                if (!user || !(await bcrypt.compare(normalizedPassword, user.password))) {
                    return res.status(401).json({ status: "error", message: "Invalid management credentials" });
                }

                const resolvedRole = user.resolved_role || requestedRole;
                let memberships = await departmentHierarchy.getUserDepartmentMembershipsAsync(user.id);
                if (!memberships.length) {
                    const repairedMembership = await ensureManagementDepartmentMembership(user, resolvedRole);
                    if (repairedMembership) {
                        memberships = [repairedMembership];
                    }
                }
                const primaryMembership = memberships[0] || null;
                const scope = departmentHierarchy.getRoleScope(resolvedRole);
                const token = jwt.sign({
                    id: user.id,
                    username: user.username,
                    role: resolvedRole,
                    scope,
                    department_id: primaryMembership?.department_id || null,
                    department_code: primaryMembership?.code || null,
                    department_name: primaryMembership?.name || null
                }, JWT_SECRET, { expiresIn: "1d" });

                return res.json({
                    status: "success",
                    message: "Management login successful",
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        role: resolvedRole,
                        scope,
                        department_id: primaryMembership?.department_id || null,
                        department_code: primaryMembership?.code || null,
                        department_name: primaryMembership?.name || null,
                        permissions: await departmentHierarchy.getRolePermissionsAsync(resolvedRole)
                    }
                });
            }

            if (requestedRole === "faculty") {
                let user;
                if (parentFamily.isPostgresConfigured()) user = await postgres.get(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role = 'faculty'
                `, [normalizedUsername]);
                else user = getLocalDevelopmentUser("SELECT * FROM users WHERE username = ? AND role = 'faculty'", [normalizedUsername]);

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

                let faculty;
                if (parentFamily.isPostgresConfigured()) faculty = await postgres.get(`
                    SELECT *
                    FROM faculty
                    WHERE user_id = ?
                `, [user.id]);
                else faculty = getLocalDevelopmentUser("SELECT * FROM faculty WHERE user_id = ?", [user.id]);

                const facultyDepartment = parentFamily.isPostgresConfigured()
                    ? await postgres.get(`
                        SELECT id, code, name
                        FROM departments
                        WHERE code = ? OR name = ? OR name ILIKE ?
                        ORDER BY id ASC
                        LIMIT 1
                    `, [faculty?.department || "", faculty?.department || "", `%${faculty?.department || ""}%`])
                    : departmentHierarchy.resolveDepartmentByNameOrCode(faculty?.department || "");
                const token = jwt.sign({
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    scope: "DEPARTMENT",
                    department_id: facultyDepartment?.id || null
                }, JWT_SECRET, { expiresIn: "1d" });
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
                let user;
                if (parentFamily.isPostgresConfigured()) user = await postgres.get(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role = 'student'
                `, [normalizedUsername]);
                else user = getLocalDevelopmentUser("SELECT * FROM users WHERE username = ? AND role = 'student'", [normalizedUsername]);

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

                let student;
                if (parentFamily.isPostgresConfigured()) student = await postgres.get(`
                    SELECT *
                    FROM students
                    WHERE user_id = ?
                `, [user.id]);
                else student = getLocalDevelopmentUser("SELECT * FROM students WHERE user_id = ?", [user.id]);

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

            const adminUser = await postgres.get(`
                SELECT *
                FROM users
                WHERE username = ?
                AND role IN ('admin', 'superadmin')
            `, [normalizedUsername]);

            if (adminUser) {
                if (adminUser.username !== ALLOWED_ADMIN_USERNAME) {
                    return res.status(401).json({
                        status: "error",
                        message: "Invalid admin credentials"
                    });
                }

                const passwordMatch = await bcrypt.compare(normalizedPassword, adminUser.password);
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

            const facultyUser = await postgres.get(`
                SELECT *
                FROM users
                WHERE username = ?
                AND role = 'faculty'
            `, [normalizedUsername]);

            if (facultyUser) {
                const passwordMatch = await bcrypt.compare(normalizedPassword, facultyUser.password);
                if (passwordMatch) {
                    const faculty = await postgres.get(`
                        SELECT *
                        FROM faculty
                        WHERE user_id = ?
                    `, [facultyUser.id]);

                    const facultyDepartment = departmentHierarchy.resolveDepartmentByNameOrCode(faculty?.department || "");
                    const token = jwt.sign({
                        id: facultyUser.id,
                        username: facultyUser.username,
                        role: facultyUser.role,
                        scope: "DEPARTMENT",
                        department_id: facultyDepartment?.id || null
                    }, JWT_SECRET, { expiresIn: "1d" });
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

            const studentUser = await postgres.get(`
                SELECT *
                FROM users
                WHERE username = ?
                AND role = 'student'
            `, [normalizedUsername]);

            if (!studentUser) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid username or password"
                });
            }

            const passwordMatch = await bcrypt.compare(normalizedPassword, studentUser.password);
            if (!passwordMatch) {
                return res.status(401).json({
                    status: "error",
                    message: "Invalid username or password"
                });
            }

            const student = await postgres.get(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `, [studentUser.id]);

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
                parent_relationship,

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

            const normalizedStudentId = safeString(roll_number || student_id).slice(0, 40);
            const normalizedRollNumber = safeString(roll_number || student_id).slice(0, 40);
            const normalizedUsername = safeString(username).slice(0, 80);
            const normalizedPassword = String(password || "");
            const normalizedFullName = safeString(full_name).slice(0, 200);
            const normalizedEmail = safeString(email).toLowerCase();
            const normalizedMobile = safeString(mobile).slice(0, 30);
            const normalizedParentMobile = safeString(parent_mobile).slice(0, 30);
            const normalizedParentEmail = safeString(parent_email).toLowerCase().slice(0, 255);

            if (
                !normalizedUsername ||
                !normalizedPassword ||
                !normalizedFullName ||
                !normalizedStudentId ||
                !normalizedEmail ||
                !isValidEmail(normalizedEmail)
            ) {

                return res.status(400).json({

                    status: "error",

                    message:
                    "Username, password, full name, valid email, and roll number are required"
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
                await postgres.get(`
                    SELECT id
                    FROM users
                    WHERE username = ?
                `, [normalizedUsername]);


            if (existingUsername) {

                return res.status(409).json({

                    status: "error",

                    message:
                        "Username already exists"

                });

            }


            // Check student ID

            const existingStudent =
                await postgres.get(`
                    SELECT id
                    FROM students
                    WHERE student_id = ? OR roll_number = ?
                `, [normalizedStudentId, normalizedRollNumber]);


            if (existingStudent) {

                return res.status(409).json({

                    status: "error",

                    message:
                        "Student ID already exists"

                });

            }


            // Hash password

            const hashedPassword =
                await bcrypt.hash(normalizedPassword, 10);

            const registration = await postgres.transaction(async transaction => {
                const userResult = await transaction.run(`
                    INSERT INTO users (username, password, role)
                    VALUES (?, ?, 'student')
                    RETURNING id
                `, [username, hashedPassword]);

                const userId = userResult.lastInsertRowid;

                await transaction.run(`
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
                `, [

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
                ]);

                const registeredStudent = await transaction.get(`
                    SELECT id, student_id, full_name, department, year, section, academic_year
                    FROM students
                    WHERE user_id = ?
                `, [userId]);

                return { userId, registeredStudent };
            });

            const parentRecord = await parentFamily.insertOrGetParentAsync({
                fullName: parent_name || "Parent / Guardian",
                mobile: parent_mobile || mobile || null,
                email: parent_email || null
            });

            if (parentRecord && registration.registeredStudent) {
                await parentFamily.ensureParentLinkAsync(
                    parentRecord.id,
                    registration.registeredStudent.id,
                    parent_relationship || "Guardian",
                    1
                );
            }

            const token = generateToken({
                id: registration.userId,
                username,
                role: "student"
            });

            return res.status(201).json({

                status: "success",

                message:
                    "Student registration successful. You are now logged in.",

                token,
                user: {
                    id: registration.userId,
                    username,
                    role: "student"
                },
                student: registration.registeredStudent

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

                        const user = await postgres.get(`
                SELECT *
                FROM users
                WHERE username = ?
                  AND role = 'faculty'
                        `, [username]);

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

            const faculty = await postgres.get(`
                SELECT *
                FROM faculty
                WHERE user_id = ?
            `, [user.id]);

            const facultyDepartment = faculty?.department
                ? await postgres.get(`
                    SELECT id, code, name
                    FROM departments
                    WHERE code = ? OR name = ? OR name ILIKE ?
                    ORDER BY id ASC
                    LIMIT 1
                `, [faculty.department, faculty.department, `%${faculty.department}%`])
                : null;
            const token = jwt.sign({
                id: user.id,
                username: user.username,
                role: user.role,
                scope: "DEPARTMENT",
                department_id: facultyDepartment?.id || null,
                department_code: facultyDepartment?.code || null,
                department_name: facultyDepartment?.name || faculty?.department || null
            }, JWT_SECRET, { expiresIn: "1d" });

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
    requireDepartmentAccess("department.student.read"),
    async (req, res) => {
        try {
            const faculty = await runtimeGet(`
                SELECT *
                FROM faculty
                WHERE user_id = ?
            `, [req.user.id]);

            if (!faculty) {
                return res.status(404).json({
                    status: "error",
                    message: "Faculty profile not found"
                });
            }

            const studentCount = await runtimeGet(`SELECT COUNT(*) AS count FROM students WHERE department = ?`, [faculty.department]);
            const attendanceCount = await runtimeGet(`
                SELECT COUNT(*) AS count
                FROM attendance a
                JOIN students s ON s.id = a.student_id
                WHERE s.department = ?
            `, [faculty.department]);
            const notificationCount = await runtimeGet(`SELECT COUNT(*) AS count FROM notifications`);
            const subjects = await runtimeAll(`
                SELECT *
                FROM subjects
                WHERE department = ?
                ORDER BY id DESC
                LIMIT 5
            `, [faculty.department || "Computer Science"]);

            return res.json({
                status: "success",
                faculty,
                summary: {
                    total_students: Number(studentCount?.count || 0),
                    total_attendance_records: Number(attendanceCount?.count || 0),
                    total_notifications: Number(notificationCount?.count || 0)
                },
                subjects
            });
        } catch (error) {
            console.error("Faculty dashboard error:", error);
            return res.status(500).json({
                status: "error",
                message: "Unable to load faculty dashboard"
            });
        }
    }
);

app.get(
    "/api/management/dashboard",
    authenticateToken,
    requireManagementAccess({ departmentPermission: "department.student.read", collegePermission: "students.view" }),
    async (req, res) => {
        const department = getManagementDepartment(req);
        const departmentFilter = department ? "WHERE s.department IN (?, ?)" : "";
        const params = department ? [department.code, department.name] : [];
        const students = await runtimeGet(`SELECT COUNT(*) AS count FROM students s ${departmentFilter}`, params);
        const faculty = await runtimeGet(`SELECT COUNT(*) AS count FROM faculty f ${department ? "WHERE f.department IN (?, ?)" : ""}`, params);
        return res.json({
            status: "success",
            scope: req.user.scope,
            role: req.user.role,
            department: department || null,
            permissions: departmentHierarchy.getRolePermissions(req.user.role),
            stats: { students: Number(students?.count || 0), faculty: Number(faculty?.count || 0) }
        });
    }
);

app.get(
    "/api/management/students",
    authenticateToken,
    requireManagementAccess({ departmentPermission: "department.student.read", collegePermission: "students.view" }),
    async (req, res) => {
        const department = getManagementDepartment(req);
        const where = department ? "WHERE s.department IN (?, ?)" : "";
        const params = department ? [department.code, department.name] : [];
        const students = await runtimeAll(`
            SELECT s.id, s.student_id, s.roll_number, s.full_name, s.department, s.year, s.section
            FROM students s ${where}
            ORDER BY s.full_name ASC
            LIMIT 500
        `, params);
        return res.json({ status: "success", students });
    }
);

app.get(
    "/api/management/faculty",
    authenticateToken,
    requireManagementAccess({ departmentPermission: "department.faculty.read", collegePermission: "faculty.view" }),
    async (req, res) => {
        const department = getManagementDepartment(req);
        const where = department ? "WHERE f.department IN (?, ?)" : "";
        const params = department ? [department.code, department.name] : [];
        const faculty = await runtimeAll(`
            SELECT f.id, f.faculty_id, f.full_name, f.department, f.designation, f.email
            FROM faculty f ${where}
            ORDER BY f.full_name ASC
            LIMIT 500
        `, params);
        return res.json({ status: "success", faculty });
    }
);

app.get(
    "/api/management/academic",
    authenticateToken,
    requireManagementAccess({ departmentPermission: "department.results.read", collegePermission: "results.view" }),
    async (req, res) => {
        const department = getManagementDepartment(req);
        const where = department ? "WHERE r.department IN (?, ?)" : "";
        const params = department ? [department.code, department.name] : [];
        const results = await runtimeAll(`
            SELECT r.department, r.subject, r.subject_code, COUNT(*) AS records,
                   AVG(r.total_marks) AS average_marks
            FROM result_records r ${where}
            GROUP BY r.department, r.subject, r.subject_code
            ORDER BY r.department, r.subject
            LIMIT 500
        `, params);
        return res.json({ status: "success", results });
    }
);

app.get(
    "/api/management/attendance",
    authenticateToken,
    requireManagementAccess({ departmentPermission: "department.attendance.read", collegePermission: "attendance.view" }),
    async (req, res) => {
        const department = getManagementDepartment(req);
        const where = department ? "WHERE s.department IN (?, ?)" : "";
        const params = department ? [department.code, department.name] : [];
        const attendance = await runtimeAll(`
            SELECT a.attendance_date, a.subject, a.status, s.student_id, s.department
            FROM attendance a JOIN students s ON s.id = a.student_id
            ${where} ORDER BY a.attendance_date DESC LIMIT 500
        `, params);
        return res.json({ status: "success", attendance });
    }
);

app.get(
    "/api/management/assignments",
    authenticateToken,
    requireManagementAccess({ departmentPermission: "department.assignments.read", collegePermission: "assignments.view" }),
    async (req, res) => {
        const department = getManagementDepartment(req);
        const where = department ? "WHERE sm.department IN (?, ?)" : "";
        const params = department ? [department.code, department.name] : [];
        const assignments = await runtimeAll(`
            SELECT a.id, a.title, a.deadline, sm.department, sm.code AS subject_code
            FROM assignments a JOIN subjects sm ON sm.id = a.subject_id
            ${where} ORDER BY a.deadline ASC, a.id DESC LIMIT 500
        `, params);
        return res.json({ status: "success", assignments });
    }
);

app.get(
    "/api/management/materials",
    authenticateToken,
    requireManagementAccess({ departmentPermission: "department.materials.read", collegePermission: "study_materials.view" }),
    async (req, res) => {
        const department = getManagementDepartment(req);
        const where = department ? "WHERE department IN (?, ?)" : "";
        const params = department ? [department.code, department.name] : [];
        const materials = await runtimeAll(`
            SELECT id, title, subject, department, year, section, created_at
            FROM study_materials ${where} ORDER BY created_at DESC, id DESC LIMIT 500
        `, params);
        return res.json({ status: "success", materials });
    }
);

app.get(
    "/api/management/notifications",
    authenticateToken,
    requireManagementAccess({ departmentPermission: "department.notifications.read", collegePermission: "notifications.view" }),
    async (req, res) => {
        const department = getManagementDepartment(req);
        const notifications = department
            ? await runtimeAll("SELECT * FROM notifications WHERE audience = 'All' OR branch IN (?, ?) ORDER BY created_at DESC LIMIT 500", [department.code, department.name])
            : await runtimeAll("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 500");
        return res.json({ status: "success", notifications });
    }
);

app.get(
    "/api/management/reports",
    authenticateToken,
    requireManagementAccess({ departmentPermission: "department.reports.read", collegePermission: "reports.view" }),
    async (req, res) => {
        const department = getManagementDepartment(req);
        const where = department ? "WHERE s.department IN (?, ?)" : "";
        const params = department ? [department.code, department.name] : [];
        const summary = await runtimeGet(`
            SELECT COUNT(*) AS students,
                   (SELECT COUNT(*) FROM faculty f ${department ? "WHERE f.department IN (?, ?)" : ""}) AS faculty
            FROM students s ${where}
        `, [...params, ...params]);
        return res.json({ status: "success", summary });
    }
);

app.get(
    "/api/management/roles",
    authenticateToken,
    requireManagementAccess({ collegePermission: "roles.manage", roles: ["admin", "superadmin"] }),
    async (req, res) => {
        const roles = await runtimeAll("SELECT name, description FROM roles ORDER BY name");
        return res.json({ status: "success", roles });
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
                await postgres.get(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role = 'student'
                `, [username]);


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
                await postgres.get(`
                    SELECT *
                    FROM students
                    WHERE user_id = ?
                `, [user.id]);


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
        return res.status(410).json({
            status: "error",
            message: "Parent login requires OTP verification. Use /api/parent/request-otp and /api/parent/verify-otp."
        });
    }
);

app.post("/api/parent/request-otp", async (req, res) => {
    try {
        const { mobile, email, purpose = "login" } = req.body || {};
        if (!["registration verification", "login", "mobile change"].includes(purpose)) {
            return res.status(400).json({ status: "error", message: "Invalid OTP purpose" });
        }
        const parent = await parentFamily.getParentByMobileOrEmailAsync(mobile, email);

        if (!parent) {
            return res.status(404).json({ status: "error", message: "Parent record not found" });
        }

        const result = await parentFamily.createParentOtpRecordAsync(parent.id, purpose, 10);
        if (!isProduction) {
            console.log(`[DEV OTP] Parent OTP issued for parent_id=${parent.id}: ${result.otp}`);
        }

        return res.json({
            status: "success",
            message: "One-time password has been issued securely. Use the development OTP from the server log in demo mode.",
            parent_id: parent.id,
            purpose
        });
    } catch (error) {
        console.error("Parent OTP request error:", error);
        return res.status(500).json({ status: "error", message: "Unable to request parent OTP" });
    }
});

app.post("/api/parent/verify-otp", async (req, res) => {
    try {
        const { mobile, email, otp, purpose = "login" } = req.body || {};
        const parent = await parentFamily.getParentByMobileOrEmailAsync(mobile, email);

        if (!parent) {
            return res.status(404).json({ status: "error", message: "Parent record not found" });
        }

        const verification = await parentFamily.verifyParentOtpAsync(parent.id, otp, purpose);
        if (!verification.valid) {
            return res.status(400).json({ status: "error", message: "OTP is invalid or expired" });
        }

        const token = jwt.sign({
            id: parent.id,
            username: parent.mobile || parent.email || `parent-${parent.id}`,
            role: "parent",
            scope: "STUDENT_LINKED",
            parent_id: parent.id,
            parent_name: parent.full_name,
            parent_mobile: parent.mobile,
            parent_email: parent.email,
            otp_verified: true
        }, JWT_SECRET, { expiresIn: "1d" });

        return res.json({
            status: "success",
            message: "Parent OTP verified successfully",
            token,
            user: {
                id: parent.id,
                username: parent.mobile || parent.email || `parent-${parent.id}`,
                role: "parent",
                scope: "STUDENT_LINKED"
            },
            children: await parentFamily.getLinkedStudentsForParentAsync(parent.id)
        });
    } catch (error) {
        console.error("Parent OTP verification error:", error);
        return res.status(500).json({ status: "error", message: "Unable to verify parent OTP" });
    }
});

app.post("/api/parent/mobile-change/request", authenticateToken, requireParent, async (req, res) => {
    try {
        const parentId = Number(req.user.parent_id || req.user.id || 0);
        const newMobile = parentFamily.normalizeParentMobile(req.body?.new_mobile);
        if (!parentId || !newMobile) {
            return res.status(400).json({ status: "error", message: "A valid new mobile number is required" });
        }
        if (newMobile === parentFamily.normalizeParentMobile(req.user.parent_mobile)) {
            return res.status(400).json({ status: "error", message: "New mobile number must be different" });
        }
        const existingParent = await parentFamily.getParentByMobileOrEmailAsync(newMobile, null);
        if (existingParent && Number(existingParent.id) !== parentId) {
            return res.status(409).json({ status: "error", message: "Mobile number is already registered" });
        }
        await parentFamily.createParentOtpRecordAsync(parentId, "mobile change", 10);
        return res.json({ status: "success", message: "Mobile change OTP requested" });
    } catch (error) {
        console.error("Parent mobile change request error:", error);
        return res.status(500).json({ status: "error", message: "Unable to request mobile change" });
    }
});

app.post("/api/parent/mobile-change/confirm", authenticateToken, requireParent, async (req, res) => {
    try {
        const parentId = Number(req.user.parent_id || req.user.id || 0);
        const newMobile = parentFamily.normalizeParentMobile(req.body?.new_mobile);
        const otp = String(req.body?.otp || "").trim();
        if (!parentId || !newMobile || !/^\d{6}$/.test(otp)) {
            return res.status(400).json({ status: "error", message: "New mobile number and 6-digit OTP are required" });
        }
        const existingParent = await parentFamily.getParentByMobileOrEmailAsync(newMobile, null);
        if (existingParent && Number(existingParent.id) !== parentId) {
            return res.status(409).json({ status: "error", message: "Mobile number is already registered" });
        }
        const verification = await parentFamily.verifyParentOtpAsync(parentId, otp, "mobile change");
        if (!verification.valid) {
            return res.status(400).json({ status: "error", message: "OTP is invalid or expired" });
        }
        const parent = await parentFamily.updateParentMobileAsync(parentId, newMobile);
        if (!parent) return res.status(404).json({ status: "error", message: "Parent record not found" });
        const token = jwt.sign({
            id: parent.id,
            username: parent.mobile || parent.email || `parent-${parent.id}`,
            role: "parent",
            scope: "STUDENT_LINKED",
            parent_id: parent.id,
            parent_name: parent.full_name,
            parent_mobile: parent.mobile,
            parent_email: parent.email,
            otp_verified: true
        }, JWT_SECRET, { expiresIn: "1d" });
        return res.json({ status: "success", message: "Parent mobile updated", token });
    } catch (error) {
        console.error("Parent mobile change confirmation error:", error);
        return res.status(500).json({ status: "error", message: "Unable to update parent mobile" });
    }
});

app.get("/api/parent/children", authenticateToken, requireParent, async (req, res) => {
    try {
        const parentId = Number(req.user.parent_id || req.user.id || 0);
        if (!parentId || req.user.role !== "parent") {
            return res.status(403).json({ status: "error", message: "Parent session not available" });
        }

        const linkedStudents = await parentFamily.getLinkedStudentsForParentAsync(parentId);
        return res.json({ status: "success", children: linkedStudents });
    } catch (error) {
        console.error("Parent children fetch error:", error);
        return res.status(500).json({ status: "error", message: "Unable to load linked children" });
    }
});

app.get(
    "/api/parent/dashboard",
    authenticateToken,
    requireParent,
    async (req, res) => {
        try {
            const parentId = Number(req.user.parent_id || req.user.id || 0);
            const requestedStudentId = req.query.student_id ? Number(req.query.student_id) : null;
            const legacyStudentId = req.user.student_id ? String(req.user.student_id).trim() : null;
            let student = null;

            if (parentId) {
                const linkedStudentId = requestedStudentId || (legacyStudentId ? Number(legacyStudentId) : null);
                if (!linkedStudentId) {
                    const linkedStudents = await parentFamily.getLinkedStudentsForParentAsync(parentId);
                    return res.json({ status: "success", student: null, children: linkedStudents });
                }

                if (parentFamily.isPostgresConfigured()) {
                    const dashboard = await parentFamily.getParentDashboardDataAsync(parentId, linkedStudentId);
                    if (!dashboard) {
                        return res.status(403).json({ status: "error", message: "Selected student is not linked to this parent" });
                    }
                    return res.json({ status: "success", ...dashboard });
                }

                const linkedStudent = await runtimeGet(`
                    SELECT s.*
                    FROM parent_student_links l
                    JOIN students s ON s.id = l.student_id
                    WHERE l.parent_id = ? AND l.student_id = ? AND l.status = 'active'
                    LIMIT 1
                `, [parentId, linkedStudentId]);

                if (!linkedStudent) {
                    return res.status(403).json({ status: "error", message: "Selected student is not linked to this parent" });
                }

                student = linkedStudent;
            } else {
                student = await runtimeGet(`SELECT * FROM students WHERE student_id = ?`, [legacyStudentId]);
            }

            if (!student) {
                return res.status(404).json({ status: "error", message: "Linked student record not found" });
            }

            const feeSummary = await runtimeGet(`
                SELECT
                    COALESCE(SUM(total_amount), 0) AS total_amount,
                    COALESCE(SUM(paid_amount), 0) AS paid_amount,
                    COALESCE(SUM(pending_amount), 0) AS pending_amount,
                    COUNT(*) AS records
                FROM fees
                WHERE student_id = ?
            `, [student.id]);

            const attendance = await runtimeAll(`
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
            `, [student.id]);

            const marks = await runtimeAll(`
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
            `, [student.id]);

            const notifications = await runtimeAll(`
                SELECT *
                FROM notifications
                WHERE audience = 'All'
                   OR audience = 'Parents'
                ORDER BY created_at DESC
                LIMIT 20
            `);

            return res.json({
                status: "success",
                student,
                feeSummary,
                attendance,
                marks,
                notifications,
                children: parentId ? await parentFamily.getLinkedStudentsForParentAsync(parentId) : []
            });

        } catch (error) {
            console.error("Parent dashboard error:", error);
            return res.status(500).json({
                status: "error",
                message: "Unable to load student profile"
            });
        }
    }
);

app.get(
    "/api/parent/student-profile",
    authenticateToken,
    requireParent,
    async (req, res) => {
        try {
            const parentId = Number(req.user.parent_id || req.user.id || 0);
            const requestedStudentId = req.query.student_id ? Number(req.query.student_id) : null;
            let student = null;

            if (parentId) {
                const studentId = requestedStudentId || Number(req.user.student_id || 0);
                if (!studentId) {
                    return res.status(400).json({ status: "error", message: "A linked student ID is required" });
                }

                if (parentFamily.isPostgresConfigured()) {
                    const profile = await parentFamily.getParentProfileDataAsync(parentId, studentId);
                    if (!profile) {
                        return res.status(403).json({ status: "error", message: "Selected student is not linked to this parent" });
                    }
                    return res.json({ status: "success", ...profile });
                }

                student = await runtimeGet(`
                    SELECT s.*
                    FROM parent_student_links l
                    JOIN students s ON s.id = l.student_id
                    WHERE l.parent_id = ? AND l.student_id = ? AND l.status = 'active'
                    LIMIT 1
                `, [parentId, studentId]);
            } else {
                student = await runtimeGet(`SELECT * FROM students WHERE student_id = ?`, [req.user.student_id]);
            }

            if (!student) {
                return res.status(403).json({
                    status: "error",
                    message: "Selected student is not linked to this parent"
                });
            }

            const attendance = await runtimeAll(`
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
            `, [student.id]);

            const marks = await runtimeAll(`
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
            `, [student.id]);

            const fees = await runtimeAll(`
                SELECT *
                FROM fees
                WHERE student_id = ?
                ORDER BY academic_year DESC, fee_year DESC
            `, [student.id]);

            const notifications = await runtimeAll(`
                SELECT *
                FROM notifications
                WHERE audience = 'All'
                   OR audience = 'Parents'
                ORDER BY created_at DESC
                LIMIT 20
            `);

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
                message: "Unable to load student profile"
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


            let user =
                await postgres.get(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                    AND role IN ('admin', 'superadmin')
                `, [username]);

            if (!user && !isProduction && String(username).startsWith("dev-")) {
                user = getLocalDevelopmentUser(`
                    SELECT * FROM users
                    WHERE username = ? AND role IN ('admin', 'superadmin')
                `, [username]);
            }


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
    async (req, res) => {

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

            const students = await runtimeAll(`
                SELECT s.*, u.username
                FROM students s
                LEFT JOIN users u ON u.id = s.user_id
                ${whereSql}
                ORDER BY s.id DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);
            const totalRow = await runtimeGet(`
                SELECT COUNT(*) AS total
                FROM students s
                ${whereSql}
            `, params);
            const total = Number(totalRow?.total || 0);

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
                message: "Unable to load students"
            });

        }

    }
);

app.get(
    "/api/admin/students/export",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const students = await runtimeAll(`
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
            `);

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
                message: "Unable to export students"
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
    async (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const department = String(req.query.department || "").trim();
            const filters = [];
            const searchParams = search
                ? [`%${search}%`, `%${search}%`, `%${search}%`]
                : [];
            if (search) filters.push("(full_name LIKE ? OR faculty_id LIKE ? OR email LIKE ?)");
            if (department) {
                filters.push("department = ?");
                searchParams.push(department);
            }
            const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

            const faculty = await runtimeAll(`
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
            `, [...searchParams, limit, offset]);
            const totalRow = await runtimeGet(`
                SELECT COUNT(*) AS total FROM faculty ${where}
            `, searchParams);
            const total = Number(totalRow?.total || 0);

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
                message: "Unable to load faculty"
            });

        }
    }
);

app.post(
    "/api/admin/faculty",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

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

            const result = await runtimeRun(`
                INSERT INTO faculty
                    (faculty_id, full_name, department, designation, email, mobile, user_id)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
                RETURNING id
            `, [
                facultyId.trim(),
                fullName.trim(),
                department?.trim() || null,
                designation?.trim() || null,
                email?.trim() || null,
                mobile?.trim() || null
            ]);

            const facultyRecordId = result.lastInsertRowid ?? result.rows?.[0]?.id;

            await runtimeRun(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `, [
                req.user.id,
                "CREATE",
                "faculty",
                facultyRecordId,
                JSON.stringify({ facultyId, fullName })
            ]);

            return res.status(201).json({
                status: "success",
                message: "Faculty record created",
                faculty_id: facultyRecordId
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
                message: "Unable to create faculty record"
            });

        }
    }
);

app.delete(
    "/api/admin/faculty/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const facultyId = Number(req.params.id);
            const result = await runtimeRun(`
                DELETE FROM faculty
                WHERE id = ?
            `, [facultyId]);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Faculty record not found"
                });
            }

            await runtimeRun(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `, [req.user.id, "DELETE", "faculty", facultyId]);

            return res.json({
                status: "success",
                message: "Faculty record deleted"
            });

        } catch (error) {

            console.error("Admin faculty delete error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to delete faculty record"
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
    async (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const where = search
                ? "WHERE s.full_name LIKE ? OR s.student_id LIKE ? OR s.roll_number LIKE ?"
                : "";
            const searchParams = search
                ? [`%${search}%`, `%${search}%`, `%${search}%`]
                : [];

            const fees = await runtimeAll(`
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
            `, [...searchParams, limit, offset]);

            const totalRow = await runtimeGet(`
                SELECT COUNT(*) AS total
                FROM fees f
                LEFT JOIN students s ON s.id = f.student_id
                ${where}
            `, searchParams);

            const summary = await runtimeGet(`
                SELECT
                    COUNT(*) AS records,
                    COALESCE(SUM(total_amount), 0) AS total_amount,
                    COALESCE(SUM(paid_amount), 0) AS paid_amount,
                    COALESCE(SUM(pending_amount), 0) AS pending_amount
                FROM fees
            `);

            return res.json({
                status: "success",
                fees,
                summary,
                pagination: { page, limit, total: Number(totalRow?.total || 0), total_pages: Math.ceil(Number(totalRow?.total || 0) / limit) }
            });

        } catch (error) {

            console.error("Admin fees load error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load fees"
            });

        }
    }
);

app.post(
    "/api/admin/fees",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

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

            const student = await runtimeGet(`
                SELECT id
                FROM students
                WHERE id = ?
            `, [numericStudentId]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student record not found"
                });
            }

            const result = await runtimeRun(`
                INSERT INTO fees
                    (student_id, academic_year, fee_year, total_amount, paid_amount, pending_amount, status)
                VALUES (?, ?, ?, ?, 0, ?, 'Pending')
                RETURNING id
            `, [
                numericStudentId,
                academicYear.trim(),
                numericFeeYear,
                numericTotal,
                numericTotal
            ]);

            const feeRecordId = result.lastInsertRowid ?? result.rows?.[0]?.id;

            await runtimeRun(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `, [
                req.user.id,
                "CREATE",
                "fee",
                feeRecordId,
                JSON.stringify({ studentId: numericStudentId, academicYear, feeYear, totalAmount: numericTotal })
            ]);

            return res.status(201).json({
                status: "success",
                message: "Fee record created",
                fee_id: feeRecordId
            });

        } catch (error) {

            console.error("Admin fee create error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to create fee record"
            });

        }
    }
);

app.delete(
    "/api/admin/fees/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const feeId = Number(req.params.id);
            const result = await runtimeRun(`
                DELETE FROM fees
                WHERE id = ?
            `, [feeId]);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Fee record not found"
                });
            }

            await runtimeRun(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `, [req.user.id, "DELETE", "fee", feeId]);

            return res.json({
                status: "success",
                message: "Fee record deleted"
            });

        } catch (error) {

            console.error("Admin fee delete error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to delete fee record"
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
    async (req, res) => {

        try {

            const buses = await runtimeAll(`
                SELECT *
                FROM buses
                ORDER BY id DESC
            `);

            const stops = await runtimeAll(`
                SELECT *
                FROM bus_stops
                ORDER BY bus_id, id
            `);

            return res.json({
                status: "success",
                buses,
                stops
            });

        } catch (error) {

            console.error("Admin buses load error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load buses"
            });

        }
    }
);

app.post(
    "/api/admin/buses",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const busNumber = String(req.body.bus_number || "").trim();
            const routeName = String(req.body.route_name || "").trim();

            if (!busNumber) {
                return res.status(400).json({
                    status: "error",
                    message: "Bus number is required"
                });
            }

            const result = await runtimeRun(`
                INSERT INTO buses (bus_number, route)
                VALUES (?, ?)
                RETURNING id
            `, [busNumber, routeName || null]);

            const busRecordId = result.lastInsertRowid ?? result.rows?.[0]?.id;

            await runtimeRun(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `, [
                req.user.id,
                "CREATE",
                "bus",
                busRecordId,
                JSON.stringify({ busNumber, routeName })
            ]);

            return res.status(201).json({
                status: "success",
                message: "Bus created",
                bus_id: busRecordId
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
                message: "Unable to create bus"
            });

        }
    }
);

app.post(
    "/api/admin/buses/:id/stops",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

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

            const bus = await runtimeGet("SELECT id FROM buses WHERE id = ?", [busId]);
            if (!bus) {
                return res.status(404).json({
                    status: "error",
                    message: "Bus not found"
                });
            }

            const result = await runtimeRun(`
                INSERT INTO bus_stops (bus_id, stop_name, pickup_time)
                VALUES (?, ?, ?)
                RETURNING id
            `, [busId, stopName, pickupTime || null]);

            return res.status(201).json({
                status: "success",
                message: "Bus stop created",
                stop_id: result.lastInsertRowid ?? result.rows?.[0]?.id
            });

        } catch (error) {

            console.error("Admin bus stop create error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to create bus stop"
            });

        }
    }
);

app.delete(
    "/api/admin/buses/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const busId = Number(req.params.id);
            const result = await runtimeRun("DELETE FROM buses WHERE id = ?", [busId]);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Bus not found"
                });
            }

            await runtimeRun(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `, [req.user.id, "DELETE", "bus", busId]);

            return res.json({
                status: "success",
                message: "Bus deleted"
            });

        } catch (error) {

            console.error("Admin bus delete error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to delete bus"
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
    async (req, res) => {

        try {

            const events = await runtimeAll(`
                SELECT *
                FROM events
                ORDER BY event_date DESC, id DESC
            `);

            const announcements = await runtimeAll(`
                SELECT *
                FROM announcements
                ORDER BY id DESC
            `);

            return res.json({
                status: "success",
                events,
                announcements
            });

        } catch (error) {

            console.error("Admin events load error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load events"
            });

        }
    }
);

app.post(
    "/api/admin/events",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

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

            const result = await runtimeRun(`
                INSERT INTO events
                    (title, description, event_date, event_time, venue, category, audience, published)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                RETURNING id
            `, [
                title,
                description || null,
                eventDate || null,
                eventTime || null,
                venue || null,
                category,
                audience
            ]);

            const eventId = result.lastInsertRowid ?? result.rows?.[0]?.id;

            await runtimeRun(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `, [req.user.id, "CREATE", "event", eventId, JSON.stringify({ title })]);

            return res.status(201).json({
                status: "success",
                message: "Event created",
                event_id: eventId
            });

        } catch (error) {

            console.error("Admin event create error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to create event"
            });

        }
    }
);

app.patch(
    "/api/admin/events/:id/publish",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const eventId = Number(req.params.id);
            const published = req.body.published ? 1 : 0;
            const result = await runtimeRun(`
                UPDATE events
                SET published = ?
                WHERE id = ?
            `, [published, eventId]);

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
                message: "Unable to update event publication"
            });

        }
    }
);

app.delete(
    "/api/admin/events/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const eventId = Number(req.params.id);
            const result = await runtimeRun("DELETE FROM events WHERE id = ?", [eventId]);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Event not found"
                });
            }

            await runtimeRun(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id)
                VALUES (?, ?, ?, ?)
            `, [req.user.id, "DELETE", "event", eventId]);

            return res.json({
                status: "success",
                message: "Event deleted"
            });

        } catch (error) {

            console.error("Admin event delete error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to delete event"
            });

        }
    }
);

app.post(
    "/api/admin/announcements",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

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

            const result = await runtimeRun(`
                INSERT INTO announcements (title, description, audience, published)
                VALUES (?, ?, ?, 0)
                RETURNING id
            `, [title, description || null, audience]);

            return res.status(201).json({
                status: "success",
                message: "Announcement created",
                announcement_id: result.lastInsertRowid ?? result.rows?.[0]?.id
            });

        } catch (error) {

            console.error("Admin announcement create error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to create announcement"
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
    async (req, res) => {

        try {

            const counts = await runtimeGet(`
                SELECT
                    (SELECT COUNT(*) FROM students) AS students,
                    (SELECT COUNT(*) FROM faculty) AS faculty,
                    (SELECT COUNT(*) FROM notifications) AS notifications,
                    (SELECT COUNT(*) FROM events) AS events,
                    (SELECT COUNT(*) FROM fees) AS fees
            `);

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
                message: "Unable to load statistics"
            });

        }

    }
);

app.get(
    "/api/admin/reports",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const summary = await runtimeGet(`
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
            `);

            const departmentBreakdown = await runtimeAll(`
                SELECT department,
                       COUNT(*) AS total_students
                FROM students
                WHERE department IS NOT NULL AND TRIM(department) != ''
                GROUP BY department
                ORDER BY total_students DESC, department ASC
            `);

            const feeStatusBreakdown = await runtimeAll(`
                SELECT status,
                       COUNT(*) AS total_records
                FROM fees
                GROUP BY status
                ORDER BY total_records DESC, status ASC
            `);

            const recentAnnouncements = await runtimeAll(`
                SELECT title,
                       message,
                       created_at
                FROM notifications
                ORDER BY created_at DESC
                LIMIT 5
            `);

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
                message: "Unable to load reports"
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
    async (req, res) => {

        try {

            let student;
            if (parentFamily.isPostgresConfigured()) student = await postgres.get(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);
            else student = db.prepare("SELECT * FROM students WHERE user_id = ?").get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            return res.json({
                status: "success",
                student
            });

        } catch (error) {
            console.error("Profile error:", error);
            return res.status(500).json({
                status: "error",
                message: "Unable to load profile"
            });
        }

    }
);

app.patch(
    "/api/student/profile",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const student = parentFamily.isPostgresConfigured()
                ? await postgres.get(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `, [req.user.id])
                : db.prepare("SELECT * FROM students WHERE user_id = ?").get(req.user.id);

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

            const setClauses = [];
            const params = [];

            Object.entries(updates).forEach(([field, value]) => {
                setClauses.push(`${field} = ?`);
                params.push(value);
            });

            params.push(req.user.id);

            let updatedStudent;
            if (parentFamily.isPostgresConfigured()) {
                await postgres.run(`UPDATE students SET ${setClauses.join(", ")} WHERE user_id = ?`, params);
                await postgres.run(`
                    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                    VALUES (?, ?, ?, ?, ?)
                `, [req.user.id, "UPDATE_PROFILE", "student", student.id, JSON.stringify({ updatedFields: Object.keys(updates) })]);
                updatedStudent = await postgres.get("SELECT * FROM students WHERE user_id = ?", [req.user.id]);
            } else {
                db.prepare(`UPDATE students SET ${setClauses.join(", ")} WHERE user_id = ?`).run(...params);
                db.prepare(`
                    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                    VALUES (?, ?, ?, ?, ?)
                `).run(req.user.id, "UPDATE_PROFILE", "student", student.id, JSON.stringify({ updatedFields: Object.keys(updates) }));
                updatedStudent = db.prepare("SELECT * FROM students WHERE user_id = ?").get(req.user.id);
            }

            return res.json({
                status: "success",
                message: "Profile updated successfully",
                student: updatedStudent
            });

        } catch (error) {
            console.error("Profile update error:", error);
            return res.status(500).json({
                status: "error",
                message: "Unable to update profile"
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
    async (req, res) => {

        try {

            let student;
            if (parentFamily.isPostgresConfigured()) student = await postgres.get(`
                SELECT id, department, year, section
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);
            else student = db.prepare("SELECT id, department, year, section FROM students WHERE user_id = ?").get(req.user.id);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            let subjects;
            if (parentFamily.isPostgresConfigured()) subjects = await postgres.all(`
                SELECT id, code, name, department, year, semester, section
                FROM subjects
                WHERE (department IS NULL OR department = ?)
                  AND (year IS NULL OR year = ?)
                  AND (section IS NULL OR section = ?)
                ORDER BY semester, code, name
            `, [student.department, student.year, student.section]);
            else subjects = db.prepare(`
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
                message: "Unable to load academic records"
            });
        }
    }
);

app.get(
    "/api/student/fees",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const student = await runtimeGet(`
                SELECT id, year
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const fees = await runtimeAll(`
                SELECT *
                FROM fees
                WHERE student_id = ?
                ORDER BY fee_year DESC, id DESC
            `, [student.id]);

            const payments = await runtimeAll(`
                SELECT *
                FROM fee_payments
                WHERE student_id = ?
                ORDER BY payment_date DESC, id DESC
            `, [student.id]);

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
                message: "Unable to load bus information"
            });

        }
    }
);

app.post(
    "/api/student/fees/pay",
    authenticateToken,
    requireStudent,
    async (req, res) => {
        try {
            const student = await runtimeGet(`
                SELECT id, year
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

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

            const fee = await runtimeGet(`
                SELECT *
                FROM fees
                WHERE id = ? AND student_id = ?
            `, [feeId, student.id]);

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

            const previousYears = await runtimeAll(`
                SELECT fee_year, pending_amount, status
                FROM fees
                WHERE student_id = ? AND fee_year < ?
            `, [student.id, fee.fee_year]);
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

            if (usePostgresRuntime) {
                await postgres.transaction(async transaction => {
                    await transaction.run(`
                        INSERT INTO fee_payments
                            (student_id, amount, payment_mode, transaction_id, payment_reference, payment_date)
                        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                        RETURNING id
                    `, [student.id, amount, method, transactionId, `fee_${feeId}`]);

                    await transaction.run(`
                        UPDATE fees
                        SET paid_amount = ?, pending_amount = ?, status = ?
                        WHERE id = ?
                    `, [nextPaid, nextPending, nextStatus, feeId]);
                });
            } else {
                db.transaction(() => {
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
                })();
            }

            await runtimeRun(`
                INSERT INTO audit_logs
                    (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `, [
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
            ]);

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
                message: "Unable to process fee payment"
            });
        }
    }
);

app.get(
    "/api/student/bus",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const assignment = await runtimeGet(`
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
            `, [req.user.id]);

            return res.json({
                status: "success",
                assignment: assignment || null
            });

        } catch (error) {

            console.error("Student bus error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load assignments"
            });

        }
    }
);

app.get(
    "/api/student/assignments",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const searchSql = search ? "AND (a.title LIKE ? OR a.description LIKE ? OR s.name LIKE ?)" : "";
            const searchParams = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];

            const assignments = await runtimeAll(`
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
            `, [req.user.id, req.user.id, req.user.id, req.user.id, ...searchParams, limit, offset]);

            return res.json({
                status: "success",
                assignments,
                pagination: { page, limit, returned: assignments.length }
            });

        } catch (error) {

            console.error("Student assignments error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load documents"
            });

        }
    }
);

app.get(
    "/api/student/documents",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const searchSql = search ? "AND (title LIKE ? OR category LIKE ?)" : "";
            const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

            const documents = await runtimeAll(`
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
            `, [req.user.id, ...searchParams, limit, offset]);

            return res.json({
                status: "success",
                documents,
                pagination: { page, limit, returned: documents.length }
            });

        } catch (error) {

            console.error("Student documents error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load exams"
            });

        }
    }
);

app.get(
    "/api/student/placements",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const student = await runtimeGet(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            const drives = await runtimeAll(`
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
            `, [student?.id || 0]);

            return res.json({
                status: "success",
                drives
            });

        } catch (error) {

            console.error("Student placements error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load placement drives"
            });

        }
    }
);

app.get(
    "/api/student/internships",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const internships = await runtimeAll(`
                SELECT *
                FROM internships
                WHERE status = 'Open'
                ORDER BY application_deadline, id DESC
            `);

            return res.json({
                status: "success",
                internships
            });

        } catch (error) {

            console.error("Student internships error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load internships"
            });

        }
    }
);

app.get(
    "/api/student/materials",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const student = await runtimeGet(`
                SELECT department, year, section
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const materials = await runtimeAll(`
                SELECT *
                FROM study_materials
                WHERE (department IS NULL OR department = ?)
                  AND (year IS NULL OR year = ?)
                  AND (section IS NULL OR section = ?)
                ORDER BY created_at DESC, id DESC
            `, [student.department, student.year, student.section]);

            return res.json({
                status: "success",
                materials
            });

        } catch (error) {

            console.error("Student materials error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load attendance"
            });

        }
    }
);

app.post(
    "/api/admin/materials",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

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

            const result = await runtimeRun(`
                INSERT INTO study_materials
                    (title, description, material_type, file_url, subject, department, year, section, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id
            `, [
                title,
                description || null,
                materialType,
                fileUrl || null,
                subject || null,
                department || null,
                year,
                section || null,
                req.user.id
            ]);

            return res.status(201).json({
                status: "success",
                material_id: result.lastInsertRowid ?? result.rows?.[0]?.id
            });

        } catch (error) {

            console.error("Admin material create error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to create study material"
            });

        }
    }
);

app.get(
    "/api/student/leave-requests",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const requests = await runtimeAll(`
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
            `, [req.user.id]);

            return res.json({
                status: "success",
                requests
            });

        } catch (error) {

            console.error("Student leave load error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load leave requests"
            });

        }
    }
);

app.post(
    "/api/student/leave-requests",
    authenticateToken,
    requireStudent,
    async (req, res) => {

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

            const student = await runtimeGet(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const result = usePostgresRuntime
                ? await postgres.run(`
                    INSERT INTO leave_requests (student_id, starts_on, ends_on, reason, status)
                    VALUES (?, ?, ?, ?, 'Pending')
                    RETURNING id
                `, [student.id, startsOn, endsOn, reason])
                : db.prepare(`
                    INSERT INTO leave_requests (student_id, starts_on, ends_on, reason, status)
                    VALUES (?, ?, ?, ?, 'Pending')
                `).run(student.id, startsOn, endsOn, reason);

            return res.status(201).json({
                status: "success",
                message: "Leave request submitted",
                request_id: result.lastInsertRowid ?? result.rows?.[0]?.id
            });

        } catch (error) {

            console.error("Student leave create error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to submit leave request"
            });

        }
    }
);

app.get(
    "/api/admin/leave-requests",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

        try {

            const requests = await runtimeAll(`
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
            `);

            return res.json({
                status: "success",
                requests
            });

        } catch (error) {

            console.error("Admin leave load error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load leave requests"
            });

        }
    }
);

app.patch(
    "/api/admin/leave-requests/:id/review",
    authenticateToken,
    requireAdmin,
    async (req, res) => {

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

            const result = await runtimeRun(`
                UPDATE leave_requests
                SET status = ?, reviewer_remarks = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [status, response || null, req.user.id, requestId]);

            if (!result.changes) {
                return res.status(404).json({
                    status: "error",
                    message: "Leave request not found"
                });
            }

            await runtimeRun(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `, [req.user.id, "REVIEW", "leave_request", requestId, JSON.stringify({ status })]);

            return res.json({
                status: "success",
                message: `Leave request ${status.toLowerCase()}`
            });

        } catch (error) {

            console.error("Admin leave review error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to review leave request"
            });

        }
    }
);

app.get(
    "/api/student/exams",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const student = await runtimeGet(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const results = await runtimeAll(`
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
            `, [student.id]);

            return res.json({
                status: "success",
                results
            });

        } catch (error) {

            console.error("Student exams error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load marks"
            });

        }
    }
);

app.get(
    "/api/student/attendance",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const student = await runtimeGet(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const subjectWise = (await runtimeAll(`
                SELECT
                    subject,
                    COUNT(*) AS conducted,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent
                FROM attendance
                WHERE student_id = ?
                GROUP BY subject
                ORDER BY subject
            `, [student.id])).map(item => ({
                ...item,
                percentage: item.conducted
                    ? Number(((item.present / item.conducted) * 100).toFixed(2))
                    : 0
            }));

            const summary = await runtimeGet(`
                SELECT
                    COUNT(*) AS conducted,
                    SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent
                FROM attendance
                WHERE student_id = ?
            `, [student.id]);

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
                message: "Unable to load notifications"
            });

        }
    }
);

app.get(
    "/api/student/marks",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);

            const student = await runtimeGet(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const marks = await runtimeAll(`
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
            `, [student.id, limit, offset]);

            return res.json({
                status: "success",
                marks,
                pagination: { page, limit, returned: marks.length }
            });

        } catch (error) {

            console.error("Student marks error:", error);

            return res.status(500).json({
                status: "error",
                message: "Unable to load marks"
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
    async (req, res) => {

        try {
            const { page, limit, offset } = getPagination(req);
            const search = getSearchTerm(req);
            const searchSql = search ? "AND (n.title LIKE ? OR n.message LIKE ?)" : "";
            const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

            const student = await runtimeGet(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const notifications = await runtimeAll(`
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
            `, [
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
            ]);

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
                message: "Unable to load notifications"
            });
        }
    }
);

app.get(
    "/api/student/notifications/unread-count",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const student = await runtimeGet(`
                SELECT *
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const result = await runtimeGet(`
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
            `, [
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
            ]);

            return res.json({
                status: "success",
                unread_count: Number(result.unread_count || 0)
            });

        } catch (error) {
            console.error("Unread Count Error:", error);
            return res.status(500).json({
                status: "error",
                message: "Unable to load notification count"
            });
        }
    }
);

app.patch(
    "/api/student/notifications/:id/read",
    authenticateToken,
    requireStudent,
    async (req, res) => {

        try {

            const notificationId = Number(req.params.id);
            const student = await runtimeGet(`
                SELECT id
                FROM students
                WHERE user_id = ?
            `, [req.user.id]);

            if (!student) {
                return res.status(404).json({
                    status: "error",
                    message: "Student profile not found"
                });
            }

            const existing = await runtimeGet(`
                SELECT id
                FROM notification_reads
                WHERE notification_id = ?
                  AND student_id = ?
            `, [notificationId, student.id]);

            if (!existing) {
                await runtimeRun(`
                    INSERT INTO notification_reads (notification_id, student_id)
                    VALUES (?, ?)
                `, [notificationId, student.id]);
            }

            return res.json({
                status: "success",
                message: "Notification marked as read"
            });

        } catch (error) {
            console.error("Mark notification read error:", error);
            return res.status(500).json({
                status: "error",
                message: "Unable to update notification status"
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
    async (req, res) => {
        try {
            const { filters, params } = getResultQueryFilters(req);
            const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

            const studentSummary = await runtimeGet(`
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
            `, params);

            const summary = await runtimeGet(`
                SELECT
                    COUNT(*) AS total_result_rows,
                    AVG(CASE WHEN total_marks IS NOT NULL THEN total_marks ELSE 0 END) AS average_percentage,
                    MAX(CASE WHEN total_marks IS NOT NULL THEN total_marks ELSE 0 END) AS highest_percentage,
                    MIN(CASE WHEN total_marks IS NOT NULL THEN total_marks ELSE 0 END) AS lowest_percentage,
                    AVG(CASE WHEN grade_point IS NOT NULL THEN grade_point ELSE 0 END) AS average_sgpa,
                    COUNT(DISTINCT CASE WHEN backlog_status IN ('Backlog', 'Arrear') THEN student_id || ':' || subject END) AS backlog_count
                FROM result_records r
                ${whereSql}
            `, params);

            const sections = await runtimeAll(`
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
                    ROUND(AVG(avg_marks)::numeric, 2) AS avg_percentage,
                    ROUND(AVG(avg_sgpa)::numeric, 2) AS avg_sgpa
                FROM student_outcomes
                GROUP BY section
                ORDER BY section ASC
            `, params);

            const subjectAnalytics = await runtimeAll(`
                SELECT
                    r.subject AS subject,
                    MIN(r.subject_code) AS subject_code,
                    COUNT(DISTINCT r.section || ':' || r.student_id) AS students_appeared,
                    COUNT(DISTINCT CASE WHEN r.pass_status = 'Pass' THEN r.section || ':' || r.student_id END) AS students_passed,
                    COUNT(DISTINCT CASE WHEN r.pass_status = 'Fail' THEN r.section || ':' || r.student_id END) AS students_failed,
                    ROUND(AVG(CASE WHEN r.total_marks IS NOT NULL THEN r.total_marks ELSE 0 END)::numeric, 2) AS average_marks,
                    MAX(CASE WHEN r.total_marks IS NOT NULL THEN r.total_marks ELSE 0 END) AS highest_marks,
                    MIN(CASE WHEN r.total_marks IS NOT NULL THEN r.total_marks ELSE 0 END) AS lowest_marks
                FROM result_records r
                ${whereSql}
                GROUP BY r.subject
                ORDER BY r.subject ASC
            `, params);

            const gradeDistribution = await runtimeAll(`
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
            `, params);

            const departmentComparison = await runtimeAll(`
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
                    ROUND(AVG(avg_marks)::numeric, 2) AS avg_percentage,
                    ROUND(AVG(avg_sgpa)::numeric, 2) AS avg_sgpa
                FROM student_outcomes
                GROUP BY department
                ORDER BY department ASC
            `, params);

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
            return res.status(500).json({ status: "error", message: "Unable to load result analytics" });
        }
    }
);

app.post(
    "/api/admin/results/import",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
            if (!rows.length) {
                return res.status(400).json({ status: "error", message: "No result rows provided for import" });
            }

            const imported = [];
            const insertResult = async (run) => {
                for (const row of rows) {
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
                    const result = await run(`
                INSERT INTO result_records (
                    student_id, department, year, semester, section, academic_year,
                    subject, subject_code, internal_marks, external_marks, total_marks,
                    grade, grade_point, pass_status, backlog_status, result_status,
                    publication_status, reviewed_by, approved_by, published_by,
                    created_by, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING id
            `, [
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
                ]);
                    imported.push({ id: result.lastInsertRowid ?? result.rows?.[0]?.id, student_id: studentId, subject });
                }
            };

            if (usePostgresRuntime) {
                await postgres.transaction(async transaction => insertResult((sql, params) => transaction.run(sql, params)));
            } else {
                await insertResult((sql, params) => runtimeRun(sql, params));
            }

            return res.status(201).json({ status: "success", message: `${imported.length} result rows imported`, imported });
        } catch (error) {
            console.error("Result import error:", error);
            return res.status(500).json({ status: "error", message: "Unable to import results" });
        }
    }
);

app.patch(
    "/api/admin/results/:id/publish",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const resultId = Number(req.params.id);
            const target = await runtimeGet(`SELECT * FROM result_records WHERE id = ?`, [resultId]);
            if (!target) {
                return res.status(404).json({ status: "error", message: "Result record not found" });
            }

            await runtimeRun(`
                UPDATE result_records
                SET publication_status = 'Published',
                    published_by = ?,
                    published_at = CURRENT_TIMESTAMP,
                    result_status = 'Published',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [req.user.id, resultId]);

            return res.json({ status: "success", message: "Results published to students" });
        } catch (error) {
            console.error("Result publish error:", error);
            return res.status(500).json({ status: "error", message: "Unable to publish results" });
        }
    }
);

app.get(
    "/api/student/results",
    authenticateToken,
    requireStudent,
    async (req, res) => {
        try {
            const student = await runtimeGet(`SELECT id, student_id, full_name, department, year, section, academic_year FROM students WHERE user_id = ?`, [req.user.id]);
            if (!student) {
                return res.status(404).json({ status: "error", message: "Student record not found" });
            }

            const records = await runtimeAll(`
                SELECT *
                FROM result_records
                WHERE student_id = ?
                ORDER BY academic_year DESC, semester ASC, created_at DESC
            `, [student.id]);

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
            return res.status(500).json({ status: "error", message: "Unable to load results" });
        }
    }
);

app.get(
    "/api/admin/notifications",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const notifications = await runtimeAll(`
                SELECT *
                FROM notifications
                ORDER BY created_at DESC
            `);

            return res.json({
                status: "success",
                notifications
            });
        } catch (error) {
            console.error("Admin notifications load error:", error);
            return res.status(500).json({
                status: "error",
                message: "Unable to load notifications"
            });
        }
    }
);

app.post(
    "/api/admin/notifications",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const { title, message, audience, branch, year, section } = req.body;

            if (!title) {
                return res.status(400).json({
                    status: "error",
                    message: "Notification title is required"
                });
            }

            const result = await runtimeRun(`
                INSERT INTO notifications (title, message, audience, branch, year, section)
                VALUES (?, ?, ?, ?, ?, ?)
                RETURNING id
            `, [
                title,
                message || "",
                audience || "All",
                branch || null,
                year ? Number(year) : null,
                section || null
            ]);

            return res.status(201).json({
                status: "success",
                message: "Notification published successfully",
                notification_id: result.lastInsertRowid ?? result.rows?.[0]?.id
            });
        } catch (error) {
            console.error("Admin notifications create error:", error);
            return res.status(500).json({
                status: "error",
                message: "Unable to publish notification"
            });
        }
    }
);

app.delete(
    "/api/admin/notifications/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const id = Number(req.params.id);
            const result = await runtimeRun(`
                DELETE FROM notifications
                WHERE id = ?
            `, [id]);

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
                message: "Unable to delete notification"
            });
        }
    }
);

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error.message === "Origin is not allowed by CORS") {
        return res.status(403).json({
            status: "error",
            message: "Origin is not allowed"
        });
    }

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

const server = app.listen(PORT, HOST, () => {
    console.log("\n==========================================");
    console.log(" KHIT FAMILY PORTAL SERVER");
    console.log("==========================================");
    console.log(` Server: http://localhost:${PORT}`);
    console.log(` API:    http://localhost:${PORT}/api/status`);
    console.log("==========================================\n");
});

function shutdown(signal) {
    console.log(`${signal} received. Shutting down gracefully.`);
    server.close(() => {
        db.close();
        process.exit(0);
    });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
