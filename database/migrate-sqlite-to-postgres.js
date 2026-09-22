const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const sqlite = require("./database");
const pool = require("./postgres");

const expectedTables = [
    "users", "roles", "permissions", "role_permissions", "user_roles", "user_role_scopes",
    "departments", "user_departments", "academic_years", "subjects", "students", "faculty",
    "parents", "parent_student_links", "parent_otp_verifications",
    "buses", "bus_stops", "placement_drives", "internships", "notifications",
    "fees", "attendance", "marks", "result_records", "notification_reads",
    "notification_recipients", "fee_payments", "fee_reimbursement", "assignments",
    "assignment_submissions", "study_materials", "leave_requests", "placement_applications",
    "documents", "announcements", "events", "gallery", "videos", "achievements",
    "profile_links", "timetable", "audit_logs", "app_settings", "password_reset_otps",
    "student_bus_assignments"
];

const expectedSqliteTotal = 43441;

const migrationOrder = [
    "users", "roles", "permissions", "role_permissions", "user_roles", "departments",
    "user_role_scopes", "user_departments", "academic_years", "subjects", "students", "faculty",
    "parents", "parent_student_links", "parent_otp_verifications",
    "buses", "bus_stops", "placement_drives", "internships", "notifications", "fees",
    "attendance", "marks", "result_records", "notification_reads", "notification_recipients",
    "fee_payments", "fee_reimbursement", "assignments", "assignment_submissions",
    "study_materials", "leave_requests", "placement_applications", "documents", "announcements",
    "events", "gallery", "videos", "achievements", "profile_links", "timetable", "audit_logs",
    "app_settings", "password_reset_otps", "student_bus_assignments"
];

const booleanColumns = new Set([
    "active", "is_active", "is_read", "published", "available"
]);

const numericColumns = new Set([
    "amount", "bus_fee", "cgpa", "external_marks", "fee_year", "grade_point", "internal_marks",
    "marks", "max_marks", "paid_amount", "pending_amount", "sgpa", "total_amount", "total_marks"
]);

const timestampColumns = new Set([
    "applied_at", "created_at", "expires_at", "paid_at", "payment_date", "published_at",
    "read_at", "reviewed_at", "submitted_at", "updated_at", "uploaded_at", "used_at"
]);

const dateColumns = new Set(["achievement_date", "attendance_date"]);

const uniqueDefinitions = [
    { table: "users", columns: ["username"] },
    { table: "students", columns: ["user_id"] },
    { table: "students", columns: ["student_id"] },
    { table: "students", columns: ["roll_number"] },
    { table: "faculty", columns: ["user_id"] },
    { table: "faculty", columns: ["faculty_id"] },
    { table: "departments", columns: ["name"] },
    { table: "academic_years", columns: ["name"] },
    { table: "buses", columns: ["bus_number"] },
    { table: "fee_payments", columns: ["transaction_id"] },
    { table: "app_settings", columns: ["setting_key"] },
    { table: "notification_reads", columns: ["notification_id", "student_id"] },
    { table: "notification_recipients", columns: ["notification_id", "student_id"] },
    { table: "assignment_submissions", columns: ["assignment_id", "student_id"] },
    { table: "student_bus_assignments", columns: ["student_id", "academic_year"] },
    { table: "placement_applications", columns: ["drive_id", "student_id"] }
];

function quoteIdentifier(value) {
    return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function quoteTable(table) {
    return `public.${quoteIdentifier(table)}`;
}

function getBackupDirectories() {
    const backupRoot = path.join(__dirname, "..", "backups");
    if (!fs.existsSync(backupRoot)) return [];

    return fs.readdirSync(backupRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(backupRoot, entry.name))
        .filter(directory => fs.existsSync(path.join(directory, "khit_family.db")))
        .sort();
}

function readSqliteTables() {
    return sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map(row => row.name);
}

function readSqliteColumns(table) {
    return sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
}

function readSqliteRows(table, columns) {
    const columnList = columns.map(column => quoteIdentifier(column.name)).join(", ");
    return sqlite.prepare(`SELECT ${columnList} FROM ${quoteIdentifier(table)}`).all();
}

function readSqliteCounts() {
    const counts = {};
    for (const table of expectedTables) {
        counts[table] = String(sqlite.prepare(
            `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`
        ).get().count);
    }
    return counts;
}

function totalRows(counts) {
    return Object.values(counts).reduce((total, count) => total + BigInt(count), 0n);
}

function logCounts(label, counts) {
    console.log(label);
    for (const table of expectedTables) {
        console.log(`  ${table}: ${counts[table] ?? 0}`);
    }
    console.log(`  TOTAL: ${totalRows(counts)}`);
}

function normalizeTimestamp(value, table, column) {
    if (value === null || value === undefined) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid timestamp in ${table}.${column}`);
    }
    return value;
}

function normalizeDate(value, table, column) {
    if (value === null || value === undefined) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        throw new Error(`Invalid date in ${table}.${column}`);
    }
    return value;
}

function normalizeValue(value, table, column) {
    if (value === undefined) return null;

    if (booleanColumns.has(column)) {
        if (value === null) return null;
        if (value === 0 || value === 1 || value === false || value === true) {
            return Boolean(value);
        }
        throw new Error(`Invalid boolean value in ${table}.${column}`);
    }

    if (numericColumns.has(column)) {
        if (value === null) return null;
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            throw new Error(`Invalid numeric value in ${table}.${column}`);
        }
        return String(value);
    }

    if (timestampColumns.has(column)) {
        return normalizeTimestamp(value, table, column);
    }

    if (dateColumns.has(column)) {
        return normalizeDate(value, table, column);
    }

    if (table === "audit_logs" && column === "metadata") {
        if (value === null) return null;
        try {
            return JSON.parse(value);
        } catch {
            throw new Error("Invalid JSON in audit_logs.metadata");
        }
    }

    return value;
}

function normalizeRows(table, columns, rows) {
    return rows.map(row => {
        const normalized = {};
        for (const column of columns) {
            normalized[column.name] = normalizeValue(row[column.name], table, column.name);
        }
        return normalized;
    });
}

async function readPostgresTables(client) {
    const result = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `);
    return result.rows.map(row => row.table_name);
}

async function readPostgresColumns(client, table) {
    const result = await client.query(`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
    `, [table]);
    return result.rows;
}

async function readPostgresCounts(client) {
    const counts = {};
    for (const table of expectedTables) {
        const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteTable(table)}`);
        counts[table] = result.rows[0].count;
    }
    return counts;
}

function assertExpectedTables(actualTables, source = "PostgreSQL") {
    const missing = expectedTables.filter(table => !actualTables.includes(table));
    const unexpected = actualTables.filter(table => !expectedTables.includes(table));
    if (missing.length || unexpected.length) {
        throw new Error(`${source} table set mismatch; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`);
    }
}

function validateSourceUniqueDefinitions() {
    for (const definition of uniqueDefinitions) {
        if (definition.table === "student_bus_assignments") continue;
        const columns = definition.columns.map(quoteIdentifier).join(", ");
        const nonNull = definition.columns
            .map(column => `${quoteIdentifier(column)} IS NOT NULL`)
            .join(" AND ");
        const result = sqlite.prepare(`
            SELECT COUNT(*) AS duplicate_groups,
                   COALESCE(SUM(group_count), 0) AS duplicate_rows
            FROM (
                SELECT COUNT(*) AS group_count
                FROM ${quoteIdentifier(definition.table)}
                WHERE ${nonNull}
                GROUP BY ${columns}
                HAVING COUNT(*) > 1
            )
        `).get();

        if (result.duplicate_groups > 0) {
            throw new Error(
                `Ambiguous SQLite uniqueness in ${definition.table} (${definition.columns.join(", ")}); ` +
                `${result.duplicate_groups} duplicate groups contain ${result.duplicate_rows} rows`
            );
        }
    }
}

function prepareStudentBusAssignments(columns, rows) {
    const comparableColumns = columns
        .map(column => column.name)
        .filter(column => column !== "id");
    const groups = new Map();

    for (const row of rows) {
        const key = `${row.student_id}\u0000${row.academic_year}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }

    const retainedRows = [];
    let excludedRows = 0;

    for (const group of groups.values()) {
        group.sort((left, right) => Number(left.id) - Number(right.id));
        for (let index = 1; index < group.length; index += 1) {
            const duplicate = group[index];
            const differs = comparableColumns.some(column => duplicate[column] !== group[0][column]);
            if (differs) {
                throw new Error(
                    "Unexpected non-identical duplicate data in student_bus_assignments " +
                    "for the same (student_id, academic_year)"
                );
            }
        }

        retainedRows.push(group[0]);
        excludedRows += group.length - 1;
    }

    if (excludedRows > 0) {
        console.log(
            "student_bus_assignments duplicate handling: " +
            `source rows: ${rows.length}; migrated rows: ${retainedRows.length}; ` +
            `excluded duplicate rows: ${excludedRows}; reason: exact duplicates for the same ` +
            "(student_id, academic_year); SQLite rows deleted: 0"
        );
    }

    return { retainedRows, excludedRows };
}

function timestampMilliseconds(value) {
    if (value instanceof Date) return value.getTime();
    const text = String(value);
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
        ? text
        : `${text.replace(" ", "T")}Z`;
    return new Date(normalized).getTime();
}

function dateOnlyValue(value) {
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, "0");
        const day = String(value.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
    return String(value).slice(0, 10);
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function valuesEqual(table, column, sourceValue, targetValue) {
    if (sourceValue === null || sourceValue === undefined) {
        return targetValue === null || targetValue === undefined;
    }
    if (targetValue === null || targetValue === undefined) return false;

    if (booleanColumns.has(column)) return Boolean(sourceValue) === Boolean(targetValue);
    if (numericColumns.has(column)) return Number(sourceValue) === Number(targetValue);
    if (timestampColumns.has(column)) return timestampMilliseconds(sourceValue) === timestampMilliseconds(targetValue);
    if (dateColumns.has(column)) return dateOnlyValue(sourceValue) === dateOnlyValue(targetValue);
    if (table === "audit_logs" && column === "metadata") {
        return stableJson(JSON.parse(sourceValue)) === stableJson(targetValue);
    }
    return String(sourceValue) === String(targetValue);
}

async function validateRows(client, table, columns, sourceRows) {
    if (!sourceRows.length) return;
    const columnList = columns.map(column => quoteIdentifier(column.name)).join(", ");
    const targetResult = await client.query(`SELECT ${columnList} FROM ${quoteTable(table)}`);
    const targetById = new Map(targetResult.rows.map(row => [String(row.id), row]));

    if (targetById.size !== sourceRows.length) {
        throw new Error(`Row validation failed for ${table}`);
    }

    for (const sourceRow of sourceRows) {
        const targetRow = targetById.get(String(sourceRow.id));
        if (!targetRow) throw new Error(`Missing migrated row in ${table}`);
        for (const column of columns) {
            if (!valuesEqual(table, column.name, sourceRow[column.name], targetRow[column.name])) {
                throw new Error(`Value validation failed for ${table}.${column.name}`);
            }
        }
    }
}

async function validateUniqueDefinitions(client) {
    for (const definition of uniqueDefinitions) {
        const columns = definition.columns.map(quoteIdentifier).join(", ");
        const result = await client.query(`
            SELECT COUNT(*)::bigint AS total, COUNT(DISTINCT (${columns}))::bigint AS distinct_count
            FROM ${quoteTable(definition.table)}
        `);
        if (result.rows[0].total !== result.rows[0].distinct_count) {
            throw new Error(`Unique constraint validation failed for ${definition.table}`);
        }
    }
}

async function validateForeignKeys(client) {
    const result = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM pg_constraint
        WHERE contype = 'f'
          AND connamespace = 'public'::regnamespace
          AND NOT convalidated
    `);
    if (result.rows[0].count !== 0) {
        throw new Error("One or more PostgreSQL foreign keys are not validated");
    }
}

function digestUsers(rows) {
    const ordered = rows
        .map(row => `${row.id}\u0000${row.password}`)
        .sort()
        .join("\u0001");
    return crypto.createHash("sha256").update(ordered).digest("hex");
}

async function validatePasswordHashes(client, sourceRows) {
    const targetResult = await client.query("SELECT id, password FROM public.users");
    if (digestUsers(sourceRows) !== digestUsers(targetResult.rows)) {
        throw new Error("Password hash preservation validation failed");
    }
}

async function repairSequences(client) {
    for (const table of expectedTables) {
        const sequenceResult = await client.query(
            "SELECT pg_get_serial_sequence($1, 'id') AS sequence_name",
            [`public.${table}`]
        );
        const sequenceName = sequenceResult.rows[0].sequence_name;
        if (!sequenceName) throw new Error(`Missing identity sequence for ${table}`);

        const maxResult = await client.query(`SELECT MAX(id) AS max_id FROM ${quoteTable(table)}`);
        const maxId = maxResult.rows[0].max_id;
        await client.query(
            "SELECT setval($1::regclass, $2::bigint, $3::boolean)",
            [sequenceName, maxId || 1, Boolean(maxId)]
        );
    }
}

async function validateSequences(client) {
    for (const table of expectedTables) {
        const sequenceResult = await client.query(
            "SELECT pg_get_serial_sequence($1, 'id') AS sequence_name",
            [`public.${table}`]
        );
        const sequenceName = sequenceResult.rows[0].sequence_name;
        const maxResult = await client.query(`SELECT MAX(id) AS max_id FROM ${quoteTable(table)}`);
        const sequenceResultAfter = await client.query(
            `SELECT last_value, is_called FROM ${sequenceName}`
        );
        const maxId = maxResult.rows[0].max_id;
        const sequenceState = sequenceResultAfter.rows[0];

        if (maxId !== null && BigInt(sequenceState.last_value) < BigInt(maxId)) {
            throw new Error(`Identity sequence validation failed for ${table}`);
        }
        if (maxId === null && sequenceState.is_called) {
            throw new Error(`Empty-table identity sequence validation failed for ${table}`);
        }
    }
}

function assertCountsUnchanged(before, after, label) {
    for (const table of expectedTables) {
        if (before[table] !== after[table]) {
            throw new Error(`SQLite row-count changed for ${table} ${label}`);
        }
    }
    if (totalRows(after) !== BigInt(expectedSqliteTotal)) {
        throw new Error(`SQLite total row-count changed ${label}`);
    }
}

function logComparison(sourceCounts, targetCounts, migratedCounts) {
    console.log("Per-table SQLite to PostgreSQL comparison:");
    for (const table of expectedTables) {
        const migrated = migratedCounts[table] ?? targetCounts[table];
        console.log(`  ${table}: SQLite ${sourceCounts[table]} -> PostgreSQL ${migrated}`);
    }
    console.log(`  SQLite TOTAL: ${totalRows(sourceCounts)}`);
    console.log(`  PostgreSQL TOTAL: ${totalRows(targetCounts)}`);
}

async function migrate() {
    const backupDirectories = getBackupDirectories();
    if (!backupDirectories.length) {
        throw new Error("No SQLite database backup found; migration aborted before inserts");
    }

    const sourceTables = readSqliteTables();
    assertExpectedTables(sourceTables, "SQLite");

    const sourceColumns = {};
    const sourceRows = {};
    const normalizedRows = {};
    const sourceCounts = {};
    const migrationRows = {};
    const migrationCounts = {};

    for (const table of expectedTables) {
        sourceColumns[table] = readSqliteColumns(table);
        sourceRows[table] = readSqliteRows(table, sourceColumns[table]);
        sourceCounts[table] = String(sourceRows[table].length);
        migrationRows[table] = sourceRows[table];
        normalizedRows[table] = normalizeRows(table, sourceColumns[table], migrationRows[table]);
        migrationCounts[table] = String(normalizedRows[table].length);
    }

    const studentBusPreparation = prepareStudentBusAssignments(
        sourceColumns.student_bus_assignments,
        sourceRows.student_bus_assignments
    );
    migrationRows.student_bus_assignments = studentBusPreparation.retainedRows;
    normalizedRows.student_bus_assignments = normalizeRows(
        "student_bus_assignments",
        sourceColumns.student_bus_assignments,
        migrationRows.student_bus_assignments
    );
    migrationCounts.student_bus_assignments = String(normalizedRows.student_bus_assignments.length);

    const client = await pool.connect();
    let transactionStarted = false;

    try {
        const targetTables = await readPostgresTables(client);
        assertExpectedTables(targetTables);
        const targetCountsBefore = await readPostgresCounts(client);

        logCounts("SQLite row counts before migration:", sourceCounts);
        logCounts("PostgreSQL row counts before migration:", targetCountsBefore);

        if (totalRows(sourceCounts) !== BigInt(expectedSqliteTotal)) {
            throw new Error(`Unexpected SQLite total row-count; expected ${expectedSqliteTotal}`);
        }
        if (totalRows(targetCountsBefore) !== 0n) {
            throw new Error("PostgreSQL contains application data; migration aborted before inserts");
        }

        validateSourceUniqueDefinitions();

        const destinationColumns = {};
        for (const table of expectedTables) {
            destinationColumns[table] = await readPostgresColumns(client, table);
            const destinationNames = new Set(destinationColumns[table].map(column => column.column_name));
            const missing = sourceColumns[table]
                .map(column => column.name)
                .filter(column => !destinationNames.has(column));
            if (missing.length) {
                throw new Error(`Unmapped columns in ${table}: ${missing.join(", ")}`);
            }
        }

        await client.query("BEGIN");
        transactionStarted = true;

        await client.query(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_years_name ON public.academic_years(name)"
        );
        await client.query(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_student_bus_assignments_student_year ON public.student_bus_assignments(student_id, academic_year)"
        );

        for (const table of migrationOrder) {
            const columns = sourceColumns[table].map(column => column.name);
            const columnList = columns.map(quoteIdentifier).join(", ");
            const batchSize = Math.min(500, Math.max(1, Math.floor(60000 / columns.length)));

            for (let start = 0; start < normalizedRows[table].length; start += batchSize) {
                const batch = normalizedRows[table].slice(start, start + batchSize);
                const values = [];
                const tuples = batch.map((row, rowIndex) => {
                    const placeholders = columns.map((column, columnIndex) => {
                        values.push(row[column]);
                        return `$${rowIndex * columns.length + columnIndex + 1}`;
                    });
                    return `(${placeholders.join(", ")})`;
                });

                await client.query(
                    `INSERT INTO ${quoteTable(table)} (${columnList}) VALUES ${tuples.join(", ")}`,
                    values
                );
            }
            console.log(`${table}: migrated ${normalizedRows[table].length} rows`);
        }

        await repairSequences(client);

        const targetCountsAfter = await readPostgresCounts(client);
        for (const table of expectedTables) {
            if (migrationCounts[table] !== targetCountsAfter[table]) {
                throw new Error(`Row-count validation failed for ${table}`);
            }
        }

        for (const table of expectedTables) {
            await validateRows(client, table, sourceColumns[table], migrationRows[table]);
        }

        await validateUniqueDefinitions(client);
        await validateForeignKeys(client);
        await validatePasswordHashes(client, sourceRows.users);
        await validateSequences(client);

        const sourceCountsDuringMigration = readSqliteCounts();
        assertCountsUnchanged(sourceCounts, sourceCountsDuringMigration, "during migration");

        await client.query("COMMIT");
        transactionStarted = false;

        const sourceCountsAfterMigration = readSqliteCounts();
        assertCountsUnchanged(sourceCounts, sourceCountsAfterMigration, "after migration");

        logComparison(sourceCounts, targetCountsAfter, migrationCounts);
        console.log(
            `student_bus_assignments: SQLite source rows = ${sourceCounts.student_bus_assignments}; ` +
            `PostgreSQL migrated rows = ${migrationCounts.student_bus_assignments}; ` +
            `Excluded exact duplicates = ${studentBusPreparation.excludedRows}`
        );
        console.log(`SQLite backup verified: ${backupDirectories[backupDirectories.length - 1]}`);
        console.log("Migration and validation completed inside one PostgreSQL transaction.");
        console.log("SQLite was read only; server.js, authentication, and frontend were not modified.");
    } catch (error) {
        if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

migrate()
    .catch(async error => {
        console.error("SQLite to PostgreSQL migration failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        sqlite.close();
        await pool.end();
    });