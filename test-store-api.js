const assert = require("assert/strict");
const fs = require("fs");
const http = require("http");
const jwt = require("jsonwebtoken");
const path = require("path");
require("dotenv").config();
const db = require("./database/database");

const baseUrl = `http://127.0.0.1:${process.env.STORE_TEST_PORT || 5001}`;
const jwtSecret = process.env.JWT_SECRET || "store-test-secret";
const marker = `STORE_VERIFY_${Date.now()}`;
const materialIds = [];
const temporaryStudentIds = [];
const uploadedFiles = [];

function request(path, options = {}) {
    return new Promise((resolve, reject) => {
        const request = http.request(`${baseUrl}${path}`, {
            method: options.method || "GET",
            headers: options.headers || {}
        }, response => {
            let raw = "";
            response.on("data", chunk => { raw += chunk; });
            response.on("end", () => {
                let body = null;
                try { body = raw ? JSON.parse(raw) : null; } catch (_error) { body = raw; }
                resolve({ status: response.statusCode, body });
            });
        });
        request.on("error", reject);
        if (options.body) request.write(options.body);
        request.end();
    });
}

function tokenFor(user) {
    return jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: "10m" });
}

function jsonOptions(token, method, payload) {
    const body = JSON.stringify(payload);
    return {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        body
    };
}

function multipartOptions(token, fields, file) {
    const boundary = `----KHITStoreVerify${Date.now()}`;
    const parts = [];
    for (const [name, value] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="store-verify.pdf"\r\nContent-Type: application/pdf\r\n\r\n`));
    parts.push(Buffer.from("%PDF-1.4 KHIT STORE API VERIFICATION\r\n"));
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    return {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length
        },
        body
    };
}

function createFixture(student, { required = 1, received = 1 } = {}) {
    const result = db.prepare(`
        INSERT INTO store_materials
            (academic_year, year, department, semester, material_type, material_name, required_quantity, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED')
    `).run(student.academic_year, student.year, student.department, 1, "MANUAL", `${marker}_${materialIds.length + 1}`, required);
    const materialId = Number(result.lastInsertRowid);
    materialIds.push(materialId);
    db.prepare(`
        INSERT INTO store_inventory (material_id, received_quantity, distributed_quantity)
        VALUES (?, ?, 0)
    `).run(materialId, received);
    return materialId;
}

async function main() {
    const admin = db.prepare("SELECT id, username, role FROM users WHERE role IN ('admin', 'superadmin') ORDER BY id LIMIT 1").get();
    const firstStudent = db.prepare("SELECT id, user_id, student_id, academic_year, year, department FROM students ORDER BY id LIMIT 1").get();
    const students = firstStudent
        ? db.prepare(`
            SELECT id, user_id, student_id, academic_year, year, department
            FROM students
            WHERE academic_year = ? AND year = ? AND department = ?
            ORDER BY id LIMIT 2
        `).all(firstStudent.academic_year, firstStudent.year, firstStudent.department)
        : [];
    assert.ok(admin, "An existing admin or superadmin account is required");
    if (students.length < 2) {
        const temporaryStudent = db.prepare(`
            INSERT INTO students
                (student_id, roll_number, full_name, department, year, academic_year)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(`${marker}_STUDENT`, `${marker}_ROLL`, "Store API verification fixture", firstStudent.department, firstStudent.year, firstStudent.academic_year);
        temporaryStudentIds.push(Number(temporaryStudent.lastInsertRowid));
        students.push(db.prepare("SELECT id, user_id, student_id, academic_year, year, department FROM students WHERE id = ?").get(temporaryStudent.lastInsertRowid));
    }
    const studentUser = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(students[0].user_id);
    const adminToken = tokenFor(admin);
    const studentToken = tokenFor(studentUser);

    const studentSummary = await request("/api/store/student/summary", { headers: { Authorization: `Bearer ${studentToken}` } });
    assert.equal(studentSummary.status, 200);
    console.log("student summary: PASS");

    const studentReports = await request("/api/store/reports/materials", { headers: { Authorization: `Bearer ${studentToken}` } });
    assert.equal(studentReports.status, 403);
    console.log("student report authorization: PASS");

    const unauthorizedDistribution = await request("/api/store/distributions", jsonOptions(studentToken, "POST", { material_id: 1, student_id: students[0].id, quantity: 1 }));
    assert.equal(unauthorizedDistribution.status, 403);
    console.log("student distribution authorization: PASS");

    const facultyUser = db.prepare("SELECT id, username, role FROM users WHERE role = 'faculty' ORDER BY id LIMIT 1").get();
    const faculty = facultyUser && db.prepare("SELECT id, department FROM faculty WHERE user_id = ?").get(facultyUser.id);
    const facultySubject = faculty && db.prepare(`
        SELECT id, year, semester, department
        FROM subjects
        WHERE LOWER(department) = LOWER(?)
        ORDER BY id LIMIT 1
    `).get(faculty.department);
    assert.ok(facultyUser && faculty && facultySubject, "A faculty account and matching subject are required");
    const facultyToken = tokenFor(facultyUser);
    const facultyCreate = await request("/api/store/materials", multipartOptions(facultyToken, {
        academic_year: firstStudent.academic_year,
        year: facultySubject.year || firstStudent.year,
        department: faculty.department,
        semester: facultySubject.semester || 1,
        subject_id: facultySubject.id,
        material_type: "MANUAL",
        material_name: `${marker}_FACULTY_MATERIAL`,
        description: "Temporary Store API verification material",
        required_quantity: 2
    }));
    assert.equal(facultyCreate.status, 201);
    materialIds.push(Number(facultyCreate.body.material_id));
    const facultyMaterials = await request("/api/store/faculty/materials", { headers: { Authorization: `Bearer ${facultyToken}` } });
    assert.equal(facultyMaterials.status, 200);
    assert.ok(facultyMaterials.body.materials.some(row => row.id === Number(facultyCreate.body.material_id)));
    console.log("faculty material ownership and upload: PASS");

    const adminSummary = await request("/api/store/summary", { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(adminSummary.status, 200);
    assert.ok(Object.prototype.hasOwnProperty.call(adminSummary.body.summary, "total_current_stock"));
    const materialReport = await request("/api/store/reports/materials?page=1&limit=5", { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(materialReport.status, 200);
    assert.equal(materialReport.body.page, 1);
    assert.equal(materialReport.body.limit, 5);
    console.log("admin summary and paginated report: PASS");

    const materialId = createFixture(students[0]);
    const negativeReceive = await request(`/api/store/inventory/${materialId}/receive`, jsonOptions(adminToken, "PUT", { received_quantity: -1 }));
    assert.equal(negativeReceive.status, 400);
    console.log("negative stock validation: PASS");

    const distribution = await request("/api/store/distributions", jsonOptions(adminToken, "POST", { material_id: materialId, student_id: students[0].id, quantity: 1 }));
    assert.equal(distribution.status, 201);
    const duplicate = await request("/api/store/distributions", jsonOptions(adminToken, "POST", { material_id: materialId, student_id: students[0].id, quantity: 1 }));
    assert.equal(duplicate.status, 409);
    console.log("valid distribution and duplicate protection: PASS");

    const history = await request("/api/store/my-history", { headers: { Authorization: `Bearer ${studentToken}` } });
    assert.equal(history.status, 200);
    assert.ok(history.body.history.some(row => row.material_name.startsWith(marker)));
    console.log("student private history: PASS");

    const concurrentMaterialId = createFixture(students[0], { required: 2, received: 1 });
    const concurrentResults = await Promise.all([
        request("/api/store/distributions", jsonOptions(adminToken, "POST", { material_id: concurrentMaterialId, student_id: students[0].id, quantity: 1 })),
        request("/api/store/distributions", jsonOptions(adminToken, "POST", { material_id: concurrentMaterialId, student_id: students[1].id, quantity: 1 }))
    ]);
    assert.deepEqual(concurrentResults.map(result => result.status).sort((a, b) => a - b), [201, 409]);
    const inventory = db.prepare("SELECT received_quantity, distributed_quantity FROM store_inventory WHERE material_id = ?").get(concurrentMaterialId);
    assert.equal(inventory.distributed_quantity, 1);
    console.log("concurrent last-item protection: PASS");

    console.log("STORE_API_TEST=PASS");
}

main()
    .catch(error => {
        console.error(`STORE_API_TEST=FAIL: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => {
        if (materialIds.length) {
            const fileRows = db.prepare(`SELECT file_path FROM store_materials WHERE id IN (${materialIds.map(() => "?").join(",")})`).all(...materialIds);
            uploadedFiles.push(...fileRows.map(row => row.file_path).filter(Boolean));
        }
        if (materialIds.length) {
            db.prepare(`DELETE FROM store_materials WHERE id IN (${materialIds.map(() => "?").join(",")})`).run(...materialIds);
        }
        for (const filePath of uploadedFiles) {
            const resolved = path.resolve(__dirname, "uploads", filePath);
            if (resolved.startsWith(path.resolve(__dirname, "uploads")) && fs.existsSync(resolved)) fs.unlinkSync(resolved);
        }
        if (temporaryStudentIds.length) {
            db.prepare(`DELETE FROM students WHERE id IN (${temporaryStudentIds.map(() => "?").join(",")})`).run(...temporaryStudentIds);
        }
        db.close();
    });
