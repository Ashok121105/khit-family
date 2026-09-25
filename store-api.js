const fs = require("fs");

const MATERIAL_TYPES = new Set([
    "MANUAL",
    "LAB_MANUAL",
    "ASSIGNMENT",
    "QUESTION_BANK",
    "LAB_RECORD",
    "STUDY_MATERIAL",
    "NOTES",
    "OTHER"
]);

const MATERIAL_STATUSES = new Set([
    "SUBMITTED",
    "RECEIVED",
    "AVAILABLE",
    "LOW_STOCK",
    "OUT_OF_STOCK",
    "COMPLETED"
]);

function parseInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function text(value, max = 255) {
    return String(value || "").trim().slice(0, max);
}

function getStatus(required, received, distributed) {
    const stock = Math.max(received - distributed, 0);
    if (received <= 0) return "SUBMITTED";
    if (required > 0 && distributed >= required) return "COMPLETED";
    if (stock <= 0) return "OUT_OF_STOCK";
    if (stock < Math.max(required - distributed, 1)) return "LOW_STOCK";
    return "AVAILABLE";
}

function materialProjection() {
    return `
        SELECT
            m.id,
            m.academic_year,
            m.year,
            m.department,
            m.semester,
            m.subject_id,
            subject.name AS subject_name,
            m.material_type,
            m.material_name,
            m.description,
            m.file_url,
            m.faculty_id,
            faculty.full_name AS faculty_name,
            m.required_quantity,
            COALESCE(inventory.received_quantity, 0) AS received_quantity,
            COALESCE(inventory.distributed_quantity, 0) AS distributed_quantity,
            COALESCE(inventory.received_quantity, 0) - COALESCE(inventory.distributed_quantity, 0) AS current_stock,
            CASE WHEN m.required_quantity - COALESCE(inventory.distributed_quantity, 0) > 0
                THEN m.required_quantity - COALESCE(inventory.distributed_quantity, 0) ELSE 0 END AS students_pending,
            CASE WHEN m.required_quantity - COALESCE(inventory.received_quantity, 0) > 0
                THEN m.required_quantity - COALESCE(inventory.received_quantity, 0) ELSE 0 END AS shortage,
            m.status,
            m.created_at,
            m.updated_at
        FROM store_materials m
        LEFT JOIN store_inventory inventory ON inventory.material_id = m.id
        LEFT JOIN subjects subject ON subject.id = m.subject_id
        LEFT JOIN faculty ON faculty.id = m.faculty_id
    `;
}

function buildMaterialFilters(query, alias = "m") {
    const clauses = [];
    const params = [];
    const academicYear = text(query.academic_year, 30);
    const department = text(query.department, 120);
    const year = parseInteger(query.year, { min: 1, max: 10 });
    const semester = parseInteger(query.semester, { min: 1, max: 20 });
    const subjectId = parseInteger(query.subject_id, { min: 1 });
    const materialType = text(query.material_type, 30).toUpperCase();
    const status = text(query.status, 30).toUpperCase();
    const search = text(query.search, 100);

    if (academicYear) { clauses.push(`${alias}.academic_year = ?`); params.push(academicYear); }
    if (department) { clauses.push(`${alias}.department = ?`); params.push(department); }
    if (year !== null) { clauses.push(`${alias}.year = ?`); params.push(year); }
    if (semester !== null) { clauses.push(`${alias}.semester = ?`); params.push(semester); }
    if (subjectId !== null) { clauses.push(`${alias}.subject_id = ?`); params.push(subjectId); }
    if (materialType) {
        if (!MATERIAL_TYPES.has(materialType)) return { error: "Invalid material type" };
        clauses.push(`${alias}.material_type = ?`);
        params.push(materialType);
    }
    if (status) {
        if (!MATERIAL_STATUSES.has(status)) return { error: "Invalid material status" };
        clauses.push(`${alias}.status = ?`);
        params.push(status);
    }
    if (search) {
        clauses.push(`(LOWER(${alias}.material_name) LIKE LOWER(?) OR LOWER(COALESCE(subject.name, '')) LIKE LOWER(?))`);
        params.push(`%${search}%`, `%${search}%`);
    }

    return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function requireStorePermission(departmentHierarchy, permission) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ status: "error", message: "Authentication required" });
        const role = String(req.user.role || "").toLowerCase();
        const allowed = ["admin", "superadmin"].includes(role)
            || departmentHierarchy.hasRolePermission(req.user, permission);
        if (!allowed) return res.status(403).json({ status: "error", message: "Permission denied" });
        return next();
    };
}

function parseRequestQuantity(value) {
    return parseInteger(value, { min: 1, max: 1000000 });
}

async function registerStoreRoutes({
    app,
    db,
    postgres,
    usePostgres,
    storage,
    upload,
    usesObjectStorage,
    authenticateToken,
    requireStudent,
    requireFaculty,
    departmentHierarchy,
    runtimeGet,
    runtimeAll,
    runtimeRun,
    getPagination,
    getSearchTerm,
    XLSX
}) {
    const storeView = requireStorePermission(departmentHierarchy, "store.materials.view");
    const inventoryView = requireStorePermission(departmentHierarchy, "store.inventory.view");
    const inventoryManage = requireStorePermission(departmentHierarchy, "store.inventory.manage");
    const distributionView = requireStorePermission(departmentHierarchy, "store.distributions.view");
    const distributionManage = requireStorePermission(departmentHierarchy, "store.distributions.manage");
    const reportView = requireStorePermission(departmentHierarchy, "store.reports.view");

    async function audit(userId, action, entityId, metadata = {}) {
        try {
            await runtimeRun(`
                INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?)
            `, [userId || null, action, "store", entityId || null, JSON.stringify(metadata)]);
        } catch (error) {
            console.error("Store audit error:", error.message);
        }
    }

    async function notifyAvailable(material) {
        try {
            await runtimeRun(`
                INSERT INTO notifications (title, message, audience, branch, year, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                "KHIT Store material available",
                `A new ${material.material_name} is available in KHIT Store.`,
                "Branch",
                material.department,
                material.year
            ]);
        } catch (error) {
            console.error("Store notification error:", error.message);
        }
    }

    async function getStudent(userId) {
        return runtimeGet(`
            SELECT id, student_id, roll_number, full_name, department, year, section, academic_year
            FROM students
            WHERE user_id = ?
        `, [userId]);
    }

    async function getFaculty(userId) {
        return runtimeGet(`
            SELECT id, faculty_id, full_name, department
            FROM faculty
            WHERE user_id = ?
        `, [userId]);
    }

    async function getMaterialForStudent(materialId, studentId, transaction = null) {
        const query = `
            SELECT m.id, m.material_name, m.department, m.year, m.academic_year, m.subject_id,
                   m.semester, m.material_type, m.status, m.file_url,
                   s.id AS student_record_id
            FROM store_materials m
            JOIN students s
              ON s.id = ?
             AND s.academic_year = m.academic_year
             AND s.department = m.department
             AND s.year = m.year
            LEFT JOIN subjects subject ON subject.id = m.subject_id
            WHERE m.id = ?
              AND (m.subject_id IS NULL OR (
                    subject.department = s.department
                    AND (subject.year IS NULL OR subject.year = s.year)
              ))
        `;
        const values = [studentId, materialId];
        return transaction
            ? transaction.get(query, values)
            : runtimeGet(query, values);
    }

    async function getPendingMaterials(studentId, transaction = null) {
        const query = `
            SELECT m.id, m.material_name, m.subject_id, subject.name AS subject_name,
                   m.material_type, m.academic_year, m.year, m.department, m.semester,
                   m.required_quantity, COALESCE(i.received_quantity, 0) AS received_quantity,
                   COALESCE(i.distributed_quantity, 0) AS distributed_quantity,
                   COALESCE(i.received_quantity, 0) - COALESCE(i.distributed_quantity, 0) AS current_stock
            FROM store_materials m
            JOIN students s
              ON s.id = ?
             AND s.academic_year = m.academic_year
             AND s.department = m.department
             AND s.year = m.year
            LEFT JOIN subjects subject ON subject.id = m.subject_id
            LEFT JOIN store_inventory i ON i.material_id = m.id
            LEFT JOIN store_distributions d
              ON d.material_id = m.id AND d.student_id = s.id AND d.status = 'COLLECTED'
            WHERE d.id IS NULL
              AND (m.subject_id IS NULL OR (
                    subject.department = s.department
                    AND (subject.year IS NULL OR subject.year = s.year)
              ))
            ORDER BY m.created_at DESC, m.id DESC
        `;
        return transaction
            ? transaction.all(query, [studentId])
            : runtimeAll(query, [studentId]);
    }

    function sendReport(res, rows, sheetName, filename) {
        if (String(res.req.query.format || "").toLowerCase() !== "xlsx") return null;
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
        return res.send(buffer);
    }

    async function runDistributionTransaction(materialId, studentId, quantity, userId) {
        const performAsync = async transaction => {
            const material = await transaction.get(`
                SELECT m.id, m.material_name, m.department, m.year, m.academic_year,
                       m.required_quantity, m.status,
                       COALESCE(i.received_quantity, 0) AS received_quantity,
                       COALESCE(i.distributed_quantity, 0) AS distributed_quantity
                FROM store_materials m
                LEFT JOIN store_inventory i ON i.material_id = m.id
                WHERE m.id = ?
                ${usePostgres ? "FOR UPDATE" : ""}
            `, [materialId]);
            if (!material) return { error: "Material not found", status: 404 };

            const student = await transaction.get(`
                SELECT id, student_id, roll_number, full_name, department, year, academic_year
                FROM students
                WHERE id = ?
                ${usePostgres ? "FOR UPDATE" : ""}
            `, [studentId]);
            if (!student) return { error: "Student not found", status: 404 };

            const eligible = await getMaterialForStudent(materialId, studentId, transaction);
            if (!eligible) return { error: "Student is not eligible for this material", status: 403 };

            const existing = await transaction.get(`
                SELECT id FROM store_distributions
                WHERE material_id = ? AND student_id = ?
            `, [materialId, studentId]);
            if (existing) return { error: "This student has already collected this material", status: 409 };

            const received = Number(material.received_quantity || 0);
            const distributed = Number(material.distributed_quantity || 0);
            if (quantity > received - distributed) {
                return { error: "Insufficient physical stock", status: 409 };
            }

            await transaction.run(`
                INSERT INTO store_distributions
                    (material_id, student_id, quantity, status, collected_at, processed_by)
                VALUES (?, ?, ?, 'COLLECTED', CURRENT_TIMESTAMP, ?)
            `, [materialId, studentId, quantity, userId]);

            const updated = await transaction.run(`
                UPDATE store_inventory
                SET distributed_quantity = distributed_quantity + ?, updated_at = CURRENT_TIMESTAMP
                WHERE material_id = ? AND distributed_quantity + ? <= received_quantity
            `, [quantity, materialId, quantity]);
            if (!updated.changes) {
                const conflict = new Error("Inventory changed; please retry the collection");
                conflict.status = 409;
                throw conflict;
            }

            const totals = await transaction.get(`
                SELECT m.required_quantity, i.received_quantity, i.distributed_quantity
                FROM store_materials m JOIN store_inventory i ON i.material_id = m.id
                WHERE m.id = ?
            `, [materialId]);
            const nextStatus = getStatus(
                Number(totals.required_quantity || 0),
                Number(totals.received_quantity || 0),
                Number(totals.distributed_quantity || 0)
            );
            await transaction.run(`
                UPDATE store_materials SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `, [nextStatus, materialId]);

            return { student, material, status: nextStatus };
        };

        const performSync = transaction => {
            const material = transaction.get(`
                SELECT m.id, m.material_name, m.department, m.year, m.academic_year,
                       m.required_quantity, m.status,
                       COALESCE(i.received_quantity, 0) AS received_quantity,
                       COALESCE(i.distributed_quantity, 0) AS distributed_quantity
                FROM store_materials m
                LEFT JOIN store_inventory i ON i.material_id = m.id
                WHERE m.id = ?
            `, [materialId]);
            if (!material) return { error: "Material not found", status: 404 };

            const student = transaction.get(`
                SELECT id, student_id, roll_number, full_name, department, year, academic_year
                FROM students
                WHERE id = ?
            `, [studentId]);
            if (!student) return { error: "Student not found", status: 404 };

            const eligible = transaction.get(`
                SELECT m.id
                FROM store_materials m
                JOIN students s
                  ON s.id = ?
                 AND s.academic_year = m.academic_year
                 AND s.department = m.department
                 AND s.year = m.year
                LEFT JOIN subjects subject ON subject.id = m.subject_id
                WHERE m.id = ?
                  AND (m.subject_id IS NULL OR (
                        subject.department = s.department
                        AND (subject.year IS NULL OR subject.year = s.year)
                  ))
            `, [studentId, materialId]);
            if (!eligible) return { error: "Student is not eligible for this material", status: 403 };

            const existing = transaction.get(`
                SELECT id FROM store_distributions
                WHERE material_id = ? AND student_id = ?
            `, [materialId, studentId]);
            if (existing) return { error: "This student has already collected this material", status: 409 };

            const received = Number(material.received_quantity || 0);
            const distributed = Number(material.distributed_quantity || 0);
            if (quantity > received - distributed) return { error: "Insufficient physical stock", status: 409 };

            transaction.run(`
                INSERT INTO store_distributions
                    (material_id, student_id, quantity, status, collected_at, processed_by)
                VALUES (?, ?, ?, 'COLLECTED', CURRENT_TIMESTAMP, ?)
            `, [materialId, studentId, quantity, userId]);

            const updated = transaction.run(`
                UPDATE store_inventory
                SET distributed_quantity = distributed_quantity + ?, updated_at = CURRENT_TIMESTAMP
                WHERE material_id = ? AND distributed_quantity + ? <= received_quantity
            `, [quantity, materialId, quantity]);
            if (!updated.changes) {
                const conflict = new Error("Inventory changed; please retry the collection");
                conflict.status = 409;
                throw conflict;
            }

            const totals = transaction.get(`
                SELECT m.required_quantity, i.received_quantity, i.distributed_quantity
                FROM store_materials m JOIN store_inventory i ON i.material_id = m.id
                WHERE m.id = ?
            `, [materialId]);
            const nextStatus = getStatus(Number(totals.required_quantity || 0), Number(totals.received_quantity || 0), Number(totals.distributed_quantity || 0));
            transaction.run("UPDATE store_materials SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextStatus, materialId]);
            return { student, material, status: nextStatus };
        };

        if (usePostgres) return postgres.transaction(performAsync);
        return db.transaction(() => {
            const transaction = {
                get: (sql, params) => db.prepare(sql).get(...params),
                run: (sql, params) => db.prepare(sql).run(...params),
                all: (sql, params) => db.prepare(sql).all(...params)
            };
            return performSync(transaction);
        })();
    }

    app.get("/api/store/student/summary", authenticateToken, requireStudent, async (req, res) => {
        try {
            const student = await getStudent(req.user.id);
            if (!student) return res.status(404).json({ status: "error", message: "Student profile not found" });
            const scope = [student.academic_year, student.department, student.year];
            const total = await runtimeGet(`
                SELECT COUNT(*) AS count
                FROM store_materials m
                WHERE m.academic_year = ? AND m.department = ? AND m.year = ?
            `, scope);
            const available = await runtimeGet(`
                SELECT COUNT(*) AS count
                FROM store_materials m LEFT JOIN store_inventory i ON i.material_id = m.id
                WHERE m.academic_year = ? AND m.department = ? AND m.year = ?
                  AND COALESCE(i.received_quantity, 0) > COALESCE(i.distributed_quantity, 0)
            `, scope);
            const collected = await runtimeGet(`
                SELECT COUNT(*) AS count
                FROM store_distributions d JOIN store_materials m ON m.id = d.material_id
                WHERE d.student_id = ? AND d.status = 'COLLECTED'
            `, [student.id]);
            const pending = await runtimeGet(`
                SELECT COUNT(*) AS count
                FROM store_materials m
                JOIN students s ON s.id = ? AND s.academic_year = m.academic_year
                    AND s.department = m.department AND s.year = m.year
                LEFT JOIN store_distributions d ON d.material_id = m.id
                    AND d.student_id = s.id AND d.status = 'COLLECTED'
                WHERE d.id IS NULL
            `, [student.id]);
            return res.json({ status: "success", student, summary: {
                total_materials: Number(total?.count || 0),
                available_materials: Number(available?.count || 0),
                my_collected_materials: Number(collected?.count || 0),
                my_pending_materials: Number(pending?.count || 0)
            }});
        } catch (error) {
            console.error("Store student summary error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load Store summary" });
        }
    });

    app.get(["/api/store/student/materials", "/api/store/my-materials"], authenticateToken, requireStudent, async (req, res) => {
        try {
            const student = await getStudent(req.user.id);
            if (!student) return res.status(404).json({ status: "error", message: "Student profile not found" });
            const filters = buildMaterialFilters(req.query, "m");
            if (filters.error) return res.status(400).json({ status: "error", message: filters.error });
            const { page, limit, offset } = getPagination(req, { defaultLimit: 20, maxLimit: 100 });
            const scope = [student.academic_year, student.department, student.year];
            const where = ["m.academic_year = ?", "m.department = ?", "m.year = ?", ...filters.where.replace(/^WHERE\s*/i, "").split(" AND ").filter(Boolean)];
            const params = [...scope, ...filters.params];
            const count = await runtimeGet(`SELECT COUNT(*) AS count FROM store_materials m LEFT JOIN subjects subject ON subject.id = m.subject_id WHERE ${where.join(" AND ")}`, params);
            const materials = await runtimeAll(`
                ${materialProjection()}
                ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?
            `, [...params, limit, offset]);
            const statuses = await runtimeAll(`
                SELECT material_id, status FROM store_distributions WHERE student_id = ?
            `, [student.id]);
            const statusByMaterial = new Map(statuses.map(row => [String(row.material_id), row.status]));
            return res.json({ status: "success", page, limit, total: Number(count?.count || 0), materials: materials.map(material => ({
                ...material,
                your_status: statusByMaterial.get(String(material.id)) || "PENDING"
            })) });
        } catch (error) {
            console.error("Store student materials error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load Store materials" });
        }
    });

    app.get(["/api/store/student/history", "/api/store/my-history"], authenticateToken, requireStudent, async (req, res) => {
        try {
            const student = await getStudent(req.user.id);
            if (!student) return res.status(404).json({ status: "error", message: "Student profile not found" });
            const { page, limit, offset } = getPagination(req, { defaultLimit: 20, maxLimit: 100 });
            const count = await runtimeGet("SELECT COUNT(*) AS count FROM store_distributions WHERE student_id = ?", [student.id]);
            const rows = await runtimeAll(`
                SELECT d.id, m.material_name, subject.name AS subject_name, m.material_type,
                       d.quantity, d.collected_at, d.status, processor.username AS processed_by
                FROM store_distributions d
                JOIN store_materials m ON m.id = d.material_id
                LEFT JOIN subjects subject ON subject.id = m.subject_id
                LEFT JOIN users processor ON processor.id = d.processed_by
                WHERE d.student_id = ?
                ORDER BY d.collected_at DESC, d.id DESC LIMIT ? OFFSET ?
            `, [student.id, limit, offset]);
            return res.json({ status: "success", page, limit, total: Number(count?.count || 0), history: rows });
        } catch (error) {
            console.error("Store student history error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load Store history" });
        }
    });

    app.post("/api/store/materials", authenticateToken, requireFaculty, requireStorePermission(departmentHierarchy, "store.materials.create"), (req, res) => {
        upload.single("file")(req, res, async uploadError => {
            if (uploadError) return res.status(400).json({ status: "error", message: uploadError.code === "LIMIT_FILE_SIZE" ? "File size must be 10 MB or less" : "Unsupported or invalid upload" });
            if (!req.file) return res.status(400).json({ status: "error", message: "A material file is required" });
            let storedFile = null;
            try {
                const faculty = await getFaculty(req.user.id);
                if (!faculty) return res.status(404).json({ status: "error", message: "Faculty profile not found" });
                const academicYear = text(req.body.academic_year, 30);
                const department = text(req.body.department, 120);
                const year = parseInteger(req.body.year, { min: 1, max: 10 });
                const semester = parseInteger(req.body.semester, { min: 1, max: 20 });
                const subjectId = parseInteger(req.body.subject_id, { min: 1 });
                const materialType = text(req.body.material_type, 30).toUpperCase();
                const materialName = text(req.body.material_name, 200);
                const requiredQuantity = parseInteger(req.body.required_quantity, { min: 0, max: 1000000 });
                if (!academicYear || !department || year === null || semester === null || subjectId === null || !materialName || requiredQuantity === null || !MATERIAL_TYPES.has(materialType)) {
                    return res.status(422).json({ status: "error", message: "Valid academic scope, subject, material type, name, and required quantity are required" });
                }
                if (department.toLowerCase() !== String(faculty.department || "").trim().toLowerCase()) {
                    return res.status(403).json({ status: "error", message: "Faculty department access denied" });
                }
                const subject = await runtimeGet("SELECT id, department, year, semester FROM subjects WHERE id = ?", [subjectId]);
                if (!subject || String(subject.department || "").toLowerCase() !== department.toLowerCase() || (subject.year !== null && Number(subject.year) !== year) || (subject.semester !== null && Number(subject.semester) !== semester)) {
                    return res.status(422).json({ status: "error", message: "Subject does not match the submitted academic scope" });
                }
                storedFile = await storage.uploadFile(req.file.path, usesObjectStorage ? `store/${req.file.filename}` : req.file.filename, req.file.mimetype);
                if (usesObjectStorage) fs.unlinkSync(req.file.path);
                const result = await runtimeRun(`
                    INSERT INTO store_materials
                        (academic_year, year, department, semester, subject_id, material_type,
                         material_name, description, file_url, file_path, faculty_id, required_quantity, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED')
                    RETURNING id
                `, [academicYear, year, department, semester, subjectId, materialType, materialName, text(req.body.description, 2000) || null, storedFile.url, storedFile.key, faculty.id, requiredQuantity]);
                const materialId = result.lastInsertRowid ?? result.rows?.[0]?.id;
                await audit(req.user.id, "STORE_MATERIAL_CREATED", materialId, { material_name: materialName, required_quantity: requiredQuantity });
                return res.status(201).json({ status: "success", material_id: materialId });
            } catch (error) {
                if (storedFile?.key) await storage.deleteObject(storedFile.key).catch(() => {});
                else if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                console.error("Store material create error:", error.message);
                return res.status(500).json({ status: "error", message: "Unable to create Store material" });
            }
        });
    });

    app.get("/api/store/faculty/materials", authenticateToken, requireFaculty, async (req, res) => {
        try {
            const faculty = await getFaculty(req.user.id);
            if (!faculty) return res.status(404).json({ status: "error", message: "Faculty profile not found" });
            const { page, limit, offset } = getPagination(req, { defaultLimit: 20, maxLimit: 100 });
            const count = await runtimeGet("SELECT COUNT(*) AS count FROM store_materials WHERE faculty_id = ?", [faculty.id]);
            const rows = await runtimeAll(`
                ${materialProjection()}
                WHERE m.faculty_id = ?
                ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?
            `, [faculty.id, limit, offset]);
            return res.json({ status: "success", page, limit, total: Number(count?.count || 0), materials: rows });
        } catch (error) {
            console.error("Store faculty materials error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load submitted materials" });
        }
    });

    app.get("/api/store/materials/:id", authenticateToken, async (req, res) => {
        try {
            const materialId = parseInteger(req.params.id, { min: 1 });
            if (materialId === null) return res.status(400).json({ status: "error", message: "Invalid material ID" });
            const material = await runtimeGet(`${materialProjection()} WHERE m.id = ?`, [materialId]);
            if (!material) return res.status(404).json({ status: "error", message: "Material not found" });
            const role = String(req.user?.role || "").toLowerCase();
            if (role === "student") {
                const student = await getStudent(req.user.id);
                if (!student || !(await getMaterialForStudent(materialId, student.id))) return res.status(403).json({ status: "error", message: "Material access denied" });
                const distribution = await runtimeGet("SELECT status, collected_at FROM store_distributions WHERE material_id = ? AND student_id = ?", [materialId, student.id]);
                return res.json({ status: "success", material: { ...material, your_status: distribution?.status || "PENDING", collected_at: distribution?.collected_at || null } });
            }
            if (role === "faculty") {
                const faculty = await getFaculty(req.user.id);
                if (!faculty || Number(material.faculty_id) !== Number(faculty.id)) return res.status(403).json({ status: "error", message: "Material access denied" });
            } else if (!(["admin", "superadmin"].includes(role) || departmentHierarchy.hasRolePermission(req.user, "store.materials.view"))) {
                return res.status(403).json({ status: "error", message: "Permission denied" });
            }
            return res.json({ status: "success", material });
        } catch (error) {
            console.error("Store material detail error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load material details" });
        }
    });

    app.get("/api/store/inventory", authenticateToken, inventoryView, async (req, res) => {
        try {
            const filters = buildMaterialFilters(req.query, "m");
            if (filters.error) return res.status(400).json({ status: "error", message: filters.error });
            const { page, limit, offset } = getPagination(req, { defaultLimit: 20, maxLimit: 100 });
            const count = await runtimeGet(`SELECT COUNT(*) AS count FROM store_materials m LEFT JOIN subjects subject ON subject.id = m.subject_id ${filters.where}`, filters.params);
            const rows = await runtimeAll(`
                ${materialProjection()}
                ${filters.where}
                ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?
            `, [...filters.params, limit, offset]);
            return res.json({ status: "success", page, limit, total: Number(count?.count || 0), inventory: rows });
        } catch (error) {
            console.error("Store inventory list error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load Store inventory" });
        }
    });

    app.put("/api/store/inventory/:materialId/receive", authenticateToken, inventoryManage, async (req, res) => {
        const materialId = parseInteger(req.params.materialId, { min: 1 });
        const receivedQuantity = parseInteger(req.body.received_quantity, { min: 0, max: 1000000 });
        if (materialId === null || receivedQuantity === null) return res.status(400).json({ status: "error", message: "Valid material ID and non-negative received quantity are required" });
        try {
            let result;
            if (usePostgres) {
                result = await postgres.transaction(async transaction => {
                    const material = await transaction.get("SELECT id, material_name, department, year, required_quantity, status FROM store_materials WHERE id = ? FOR UPDATE", [materialId]);
                    if (!material) return { error: "Material not found", status: 404 };
                    await transaction.run("INSERT INTO store_inventory (material_id, received_quantity, distributed_quantity) VALUES (?, 0, 0) ON CONFLICT (material_id) DO NOTHING", [materialId]);
                    const inventory = await transaction.get("SELECT received_quantity, distributed_quantity FROM store_inventory WHERE material_id = ? FOR UPDATE", [materialId]);
                    const nextReceived = Number(inventory.received_quantity || 0) + receivedQuantity;
                    const nextStatus = getStatus(Number(material.required_quantity || 0), nextReceived, Number(inventory.distributed_quantity || 0));
                    await transaction.run("UPDATE store_inventory SET received_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE material_id = ?", [nextReceived, materialId]);
                    await transaction.run("UPDATE store_materials SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [nextStatus, materialId]);
                    return { material, nextStatus, becameAvailable: Number(inventory.received_quantity || 0) === 0 && nextReceived > 0 };
                });
            } else {
                result = db.transaction(() => {
                    const material = db.prepare("SELECT id, material_name, department, year, required_quantity, status FROM store_materials WHERE id = ?").get(materialId);
                    if (!material) return { error: "Material not found", status: 404 };
                    db.prepare("INSERT OR IGNORE INTO store_inventory (material_id, received_quantity, distributed_quantity) VALUES (?, 0, 0)").run(materialId);
                    const inventory = db.prepare("SELECT received_quantity, distributed_quantity FROM store_inventory WHERE material_id = ?").get(materialId);
                    const nextReceived = Number(inventory.received_quantity || 0) + receivedQuantity;
                    const nextStatus = getStatus(Number(material.required_quantity || 0), nextReceived, Number(inventory.distributed_quantity || 0));
                    db.prepare("UPDATE store_inventory SET received_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE material_id = ?").run(nextReceived, materialId);
                    db.prepare("UPDATE store_materials SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextStatus, materialId);
                    return { material, nextStatus, becameAvailable: Number(inventory.received_quantity || 0) === 0 && nextReceived > 0 };
                })();
            }
            if (result?.error) return res.status(result.status).json({ status: "error", message: result.error });
            await audit(req.user.id, "STORE_STOCK_RECEIVED", materialId, { received_quantity: receivedQuantity });
            if (result.becameAvailable) await notifyAvailable(result.material);
            return res.json({ status: "success", material_id: materialId, status_value: result.nextStatus });
        } catch (error) {
            console.error("Store stock receive error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to receive Store stock" });
        }
    });

    app.post("/api/store/distributions", authenticateToken, distributionManage, async (req, res) => {
        const materialId = parseInteger(req.body.material_id, { min: 1 });
        const studentId = parseInteger(req.body.student_id, { min: 1 });
        const quantity = parseRequestQuantity(req.body.quantity);
        if (materialId === null || studentId === null || quantity === null) return res.status(400).json({ status: "error", message: "Valid material ID, student ID, and positive quantity are required" });
        try {
            const result = await runDistributionTransaction(materialId, studentId, quantity, req.user.id);
            if (result?.error) return res.status(result.status).json({ status: "error", message: result.error });
            await audit(req.user.id, "STORE_DISTRIBUTION_CREATED", materialId, { student_id: studentId, quantity });
            return res.status(201).json({ status: "success", message: "Material collection recorded", distribution: { material_id: materialId, student_id: studentId, quantity, status: "COLLECTED", inventory_status: result.status } });
        } catch (error) {
            const duplicate = error.code === "23505" || String(error.code || "").startsWith("SQLITE_CONSTRAINT");
            const conflict = error.status === 409;
            console.error("Store distribution error:", error.message);
            return res.status(duplicate || conflict ? 409 : 500).json({ status: "error", message: duplicate ? "This student has already collected this material" : conflict ? error.message : "Unable to record material collection" });
        }
    });

    app.get("/api/store/students", authenticateToken, distributionView, async (req, res) => {
        try {
            const { page, limit, offset } = getPagination(req, { defaultLimit: 20, maxLimit: 100 });
            const search = getSearchTerm(req);
            if (!search) return res.status(400).json({ status: "error", message: "A roll number, student ID, or name search is required" });
            const pattern = `%${search}%`;
            const where = `(s.student_id LIKE ? OR s.roll_number LIKE ? OR LOWER(s.full_name) LIKE LOWER(?))`;
            const params = [pattern, pattern, pattern];
            const count = await runtimeGet(`SELECT COUNT(*) AS count FROM students s WHERE ${where}`, params);
            const rows = await runtimeAll(`
                SELECT s.id, s.student_id, s.roll_number, s.full_name, s.department, s.year,
                       (SELECT COUNT(*) FROM store_materials m
                        WHERE m.academic_year = s.academic_year AND m.department = s.department AND m.year = s.year
                          AND NOT EXISTS (SELECT 1 FROM store_distributions d WHERE d.material_id = m.id AND d.student_id = s.id AND d.status = 'COLLECTED')) AS eligible_pending_materials
                FROM students s WHERE ${where}
                ORDER BY s.full_name ASC, s.id ASC LIMIT ? OFFSET ?
            `, [...params, limit, offset]);
            return res.json({ status: "success", page, limit, total: Number(count?.count || 0), students: rows });
        } catch (error) {
            console.error("Store student lookup error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to search Store students" });
        }
    });

    app.get("/api/store/summary", authenticateToken, reportView, async (req, res) => {
        try {
            const summary = await runtimeGet(`
                SELECT COUNT(*) AS total_materials,
                       COALESCE(SUM(m.required_quantity), 0) AS total_required_quantity,
                       COALESCE(SUM(COALESCE(i.received_quantity, 0)), 0) AS total_received_quantity,
                       COALESCE(SUM(COALESCE(i.distributed_quantity, 0)), 0) AS total_distributed_quantity,
                       COALESCE(SUM(COALESCE(i.received_quantity, 0) - COALESCE(i.distributed_quantity, 0)), 0) AS total_current_stock,
                       COALESCE(SUM(CASE WHEN COALESCE(i.received_quantity, 0) - COALESCE(i.distributed_quantity, 0) > 0
                            AND COALESCE(i.received_quantity, 0) - COALESCE(i.distributed_quantity, 0) < m.required_quantity - COALESCE(i.distributed_quantity, 0) THEN 1 ELSE 0 END), 0) AS low_stock_materials,
                       COALESCE(SUM(CASE WHEN COALESCE(i.received_quantity, 0) > 0 AND COALESCE(i.received_quantity, 0) = COALESCE(i.distributed_quantity, 0) THEN 1 ELSE 0 END), 0) AS out_of_stock_materials,
                       COALESCE(SUM(CASE WHEN m.required_quantity - COALESCE(i.distributed_quantity, 0) > 0 THEN m.required_quantity - COALESCE(i.distributed_quantity, 0) ELSE 0 END), 0) AS pending_student_collections
                FROM store_materials m LEFT JOIN store_inventory i ON i.material_id = m.id
            `);
            return res.json({ status: "success", summary });
        } catch (error) {
            console.error("Store summary error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load Store summary" });
        }
    });

    app.get("/api/store/reports/materials", authenticateToken, reportView, async (req, res) => {
        try {
            const filters = buildMaterialFilters(req.query, "m");
            if (filters.error) return res.status(400).json({ status: "error", message: filters.error });
            const { page, limit, offset } = getPagination(req, { defaultLimit: 50, maxLimit: 500 });
            const count = await runtimeGet(`SELECT COUNT(*) AS count FROM store_materials m LEFT JOIN subjects subject ON subject.id = m.subject_id ${filters.where}`, filters.params);
            const rows = await runtimeAll(`
                ${materialProjection()}
                ${filters.where}
                ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?
            `, [...filters.params, limit, offset]);
            const response = sendReport(res, rows, "Materials", "khit-store-materials.xlsx");
            if (response) return response;
            return res.json({ status: "success", page, limit, total: Number(count?.count || 0), rows });
        } catch (error) {
            console.error("Store material report error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load material report" });
        }
    });

    app.get("/api/store/reports/pending", authenticateToken, reportView, async (req, res) => {
        try {
            const filters = buildMaterialFilters(req.query, "m");
            if (filters.error) return res.status(400).json({ status: "error", message: filters.error });
            const { page, limit, offset } = getPagination(req, { defaultLimit: 50, maxLimit: 500 });
            const baseWhere = ["s.academic_year = m.academic_year", "s.department = m.department", "s.year = m.year", ...filters.where.replace(/^WHERE\s*/i, "").split(" AND ").filter(Boolean)];
            const params = [...filters.params];
            const count = await runtimeGet(`SELECT COUNT(*) AS count FROM students s JOIN store_materials m ON ${baseWhere.join(" AND ")} LEFT JOIN store_distributions d ON d.material_id = m.id AND d.student_id = s.id AND d.status = 'COLLECTED' WHERE d.id IS NULL`, params);
            const rows = await runtimeAll(`
                SELECT s.student_id, s.roll_number, s.full_name, s.department, s.year,
                       m.material_name, subject.name AS subject_name, m.material_type, 'PENDING' AS status
                FROM students s JOIN store_materials m ON ${baseWhere.join(" AND ")}
                LEFT JOIN subjects subject ON subject.id = m.subject_id
                LEFT JOIN store_distributions d ON d.material_id = m.id AND d.student_id = s.id AND d.status = 'COLLECTED'
                WHERE d.id IS NULL
                ORDER BY s.full_name ASC, m.material_name ASC LIMIT ? OFFSET ?
            `, [...params, limit, offset]);
            const response = sendReport(res, rows, "Pending", "khit-store-pending.xlsx");
            if (response) return response;
            return res.json({ status: "success", page, limit, total: Number(count?.count || 0), rows });
        } catch (error) {
            console.error("Store pending report error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load pending report" });
        }
    });

    app.get("/api/store/reports/distributions", authenticateToken, reportView, async (req, res) => {
        try {
            const { page, limit, offset } = getPagination(req, { defaultLimit: 50, maxLimit: 500 });
            const search = getSearchTerm(req);
            const conditions = [];
            const params = [];
            if (search) {
                conditions.push("(s.student_id LIKE ? OR s.roll_number LIKE ? OR LOWER(s.full_name) LIKE LOWER(?) OR LOWER(m.material_name) LIKE LOWER(?))");
                params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
            }
            const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
            const count = await runtimeGet(`SELECT COUNT(*) AS count FROM store_distributions d JOIN students s ON s.id = d.student_id JOIN store_materials m ON m.id = d.material_id ${where}`, params);
            const rows = await runtimeAll(`
                SELECT s.student_id, s.roll_number, s.full_name, s.department, s.year,
                       m.material_name, subject.name AS subject_name, d.quantity,
                       d.collected_at, processor.username AS processed_by, d.status
                FROM store_distributions d
                JOIN students s ON s.id = d.student_id
                JOIN store_materials m ON m.id = d.material_id
                LEFT JOIN subjects subject ON subject.id = m.subject_id
                LEFT JOIN users processor ON processor.id = d.processed_by
                ${where}
                ORDER BY d.collected_at DESC, d.id DESC LIMIT ? OFFSET ?
            `, [...params, limit, offset]);
            const response = sendReport(res, rows, "Distributions", "khit-store-distributions.xlsx");
            if (response) return response;
            return res.json({ status: "success", page, limit, total: Number(count?.count || 0), rows });
        } catch (error) {
            console.error("Store distribution report error:", error.message);
            return res.status(500).json({ status: "error", message: "Unable to load distribution report" });
        }
    });
}

module.exports = { registerStoreRoutes, MATERIAL_TYPES, MATERIAL_STATUSES, getStatus };
