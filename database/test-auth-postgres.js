const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const adapter = require("./postgres-adapter");

async function testAuthPostgres() {
    const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const section = (startMarker, endMarker) => {
        const start = serverSource.includes(startMarker)
            ? serverSource.lastIndexOf(startMarker)
            : -1;
        const end = serverSource.indexOf(endMarker, start + startMarker.length);
        assert.notEqual(start, -1, `Missing auth marker: ${startMarker}`);
        assert.notEqual(end, -1, `Missing auth marker: ${endMarker}`);
        return serverSource.slice(start, end);
    };
    const authSections = [
        section("// GENERIC LOGIN", "// STUDENT REGISTRATION"),
        section("// STUDENT REGISTRATION", "// STUDENT LOGIN"),
        section('"/api/faculty/login"', '"/api/faculty/dashboard"'),
        section('"/api/student/login"', "// PARENT LOGIN"),
        section('"/api/parent/login"', '"/api/parent/dashboard"'),
        section('"/api/admin/login"', '"/api/admin/students"')
    ];
    authSections.forEach((authSection, index) => {
        assert.equal(
            /db\.(prepare|exec|pragma)/.test(authSection),
            false,
            `Authentication section ${index} still contains a direct SQLite call`
        );
    });

    const studentUser = await adapter.get(
        "SELECT id, username, password, role FROM users WHERE username = ? AND role = 'student'",
        ["student"]
    );
    assert.ok(studentUser);
    assert.equal(studentUser.role, "student");
    assert.equal(await bcrypt.compare("student123", studentUser.password), true);
    assert.equal(await bcrypt.compare("incorrect-password", studentUser.password), false);

    const facultyUser = await adapter.get(
        "SELECT id, username, password, role FROM users WHERE username = ? AND role = 'faculty'",
        ["faculty"]
    );
    assert.ok(facultyUser);
    assert.equal(facultyUser.role, "faculty");
    assert.equal(await bcrypt.compare("faculty123", facultyUser.password), true);

    const adminUser = await adapter.get(
        "SELECT id, username, password, role FROM users WHERE role IN ('admin', 'superadmin') ORDER BY id LIMIT 1"
    );
    assert.ok(adminUser);
    assert.ok(["admin", "superadmin"].includes(adminUser.role));
    assert.equal(await adapter.get("SELECT id FROM users WHERE username = ?", ["does-not-exist"]), undefined);

    const parentStudent = await adapter.get(`
        SELECT id, user_id, student_id, full_name, parent_name
        FROM students
        WHERE student_id = ?
          AND (parent_mobile = ? OR parent_email = ?)
    `, ["STU-1001", "9876500001", "parent@khit.edu.in"]);
    assert.ok(parentStudent);
    assert.equal(parentStudent.student_id, "STU-1001");

    const token = jwt.sign(
        { id: studentUser.id, username: studentUser.username, role: studentUser.role },
        process.env.JWT_SECRET || "khit_family_secret_local_only",
        { expiresIn: "1d" }
    );
    const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "khit_family_secret_local_only"
    );
    assert.equal(decoded.id, studentUser.id);
    assert.equal(decoded.role, "student");

    const duplicateUsername = await adapter.get(
        "SELECT id FROM users WHERE username = ?",
        ["student"]
    );
    assert.ok(duplicateUsername);

    const testUsername = `step11c_${Date.now()}`;
    const testStudentId = `STEP11C-${Date.now()}`;
    const testPassword = "Step11C-test-password";
    await assert.rejects(
        adapter.transaction(async transaction => {
            const passwordHash = await bcrypt.hash(testPassword, 10);
            const insertedUser = await transaction.run(`
                INSERT INTO users (username, password, role)
                VALUES (?, ?, 'student')
                RETURNING id
            `, [testUsername, passwordHash]);
            const insertedStudent = await transaction.run(`
                INSERT INTO students (user_id, student_id, roll_number, full_name, email)
                VALUES (?, ?, ?, ?, ?)
                RETURNING id
            `, [insertedUser.lastInsertRowid, testStudentId, testStudentId, "Step 11C Test", `${testUsername}@example.invalid`]);
            assert.ok(insertedStudent.lastInsertRowid);

            const createdUser = await transaction.get(
                "SELECT id, password, role FROM users WHERE username = ?",
                [testUsername]
            );
            assert.equal(createdUser.role, "student");
            assert.equal(await bcrypt.compare(testPassword, createdUser.password), true);
            throw new Error("intentional registration rollback test");
        }),
        /intentional registration rollback test/
    );

    assert.equal(
        await adapter.get("SELECT id FROM users WHERE username = ?", [testUsername]),
        undefined
    );
    assert.equal(
        await adapter.get("SELECT id FROM students WHERE student_id = ?", [testStudentId]),
        undefined
    );

    console.log("PostgreSQL authentication/registration checks successful.");
}

testAuthPostgres()
    .catch(error => {
        console.error("PostgreSQL authentication/registration checks failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await adapter.pool.end();
    });
