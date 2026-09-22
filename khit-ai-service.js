const CLOSED_DOMAIN_MESSAGE = "I can help only with information available through the KHIT Family Portal and authorized college information.";
const AUTHORIZED_MESSAGE = "I can only help with information you are authorized to access through the KHIT Family Portal.";
const followUpContext = new Map();

function normalizeMessage(message) {
    return String(message || "").trim().slice(0, 1000);
}

function detectIntent(message) {
    const text = message.toLowerCase();
    if (/^\s*([1-4])\s*[-/]\s*([1-2])\s*\??\s*$/i.test(text) || /(first|second|third|fourth|మొదటి|రెండవ|మూడవ|నాలుగవ)\s*(one|event|notification|announcement|document|material|దాన్ని|దాని)?/i.test(text)) return "followup";
    if (/(other student|another student|roll number|student id|వేరే విద్యార్థి|ఇతర విద్యార్థి)/i.test(text)) return "protected";
    if (/(result|results|marks|grade|semester|\b\d\s*[-/]\s*\d\b|రిజల్ట్|రిజల్ట్స్|ఫలిత|మార్క్)/i.test(text)) return "results";
    if (/(attendance|attendence|present|absent|అటెండెన్స్|అటెండెన్సు|హాజరు)/i.test(text)) return "attendance";
    if (/(fee|fees|payment|paid|pending|ఫీజు|ఫీజుల|చెల్లింపు)/i.test(text)) return "fees";
    if (/(announcement|college announcement|ప్రకటన|కళాశాల ప్రకటన)/i.test(text)) return "announcements";
    if (/(notification|notice|నోటిఫికేషన్)/i.test(text)) return "notifications";
    if (/(event|events|college function|ఎవెంట్|ఈవెంట్స్|కళాశాల కార్యక్రమం|కళాశాల ఈవెంట్)/i.test(text)) return "events";
    if (/(assignment|assignments|homework|అసైన్‌మెంట్|అసైన్‌మెంట్లు|హోంవర్క్)/i.test(text)) return "assignments";
    if (/(study material|study materials|material|చదువు సామగ్రి|అధ్యయన సామగ్రి)/i.test(text)) return "materials";
    if (/(document|documents|certificate|పత్రం|పత్రాలు)/i.test(text)) return "documents";
    return "outside";
}

function isTelugu(message) {
    return /[\u0C00-\u0C7F]/.test(String(message || ""));
}

function isTeluguMix(message) {
    return /\b(na|naa|cheppu|entha|vachaya|undhi|enti|em|my|latest)\b/i.test(String(message || ""));
}

function isTeluguLike(message) {
    return isTelugu(message) || isTeluguMix(message);
}

function extractSubject(message) {
    const subjectFirst = String(message || "").match(/\b([A-Z][A-Z0-9-]{1,12})\s+subject\b/i);
    if (subjectFirst) return subjectFirst[1].trim();
    const match = String(message || "").match(/(?:subject|లో|of)\s+([a-z][a-z0-9 &-]{1,60})/i);
    return match ? match[1].trim() : null;
}

function parseSemester(message) {
    const match = String(message).match(/\b([1-4])\s*[-/]\s*([1-2])\b/);
    return match ? { year: Number(match[1]), semester: Number(match[2]), label: `${match[1]}-${match[2]}` } : null;
}

function toSafeNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
}

function ordinalIndex(message) {
    const text = String(message || "").toLowerCase();
    if (/\b(first|1st|మొదటి)\b/.test(text)) return 0;
    if (/\b(second|2nd|రెండవ)\b/.test(text)) return 1;
    if (/\b(third|3rd|మూడవ)\b/.test(text)) return 2;
    if (/\b(fourth|4th|నాలుగవ)\b/.test(text)) return 3;
    const number = text.match(/\b([1-4])\b/);
    return number ? Number(number[1]) - 1 : null;
}

function formatOfficialItems(rows, label, message, details) {
    if (!rows.length) return null;
    const telugu = isTeluguLike(message);
    const items = rows.map((row, index) => ({
        index: index + 1,
        title: row.title || row.document_name || row.name || "Official portal item",
        summary: row.description || row.message || row.category || null,
        date: row.created_at || row.published_at || row.event_date || row.uploaded_at || null,
        ...details(row)
    }));
    const lines = items.slice(0, 10).map((item) => {
        const suffix = [item.date, item.extra].filter(Boolean).join(" | ");
        return `${item.index}. ${item.title}${suffix ? ` — ${suffix}` : ""}`;
    });
    const plural = { notification: "notifications", event: "events", announcement: "announcements", "study material": "study materials", document: "documents" }[label] || `${label}s`;
    const prefix = telugu ? `${items.length} అధికారిక పోర్టల్ ${plural} ఉన్నాయి:` : `I found ${items.length} official portal ${plural}:`;
    const follow = telugu ? "ఏదైనా వివరంగా చెప్పాలంటే మొదటి/రెండవది చెప్పండి." : "Tell me which one to explain, for example: first one.";
    return { message: `${prefix}\n${lines.join("\n")}\n${follow}`, items };
}

function createKhitAiService({ db, postgres, parentFamily, departmentHierarchy }) {
    const usePostgres = parentFamily.isPostgresConfigured();

    async function queryOne(sql, params = []) {
        return usePostgres ? postgres.get(sql, params) : db.prepare(sql).get(...params);
    }

    async function queryAll(sql, params = []) {
        return usePostgres ? postgres.all(sql, params) : db.prepare(sql).all(...params);
    }

    async function getStudentForUser(user) {
        if (user.role !== "student") return null;
        return queryOne("SELECT id, student_id, full_name, department, year, section FROM students WHERE user_id = ?", [user.id]);
    }

    async function getAuthorizedStudent(user, requestedStudentId) {
        if (user.role === "student") {
            if (requestedStudentId !== undefined && requestedStudentId !== null && String(requestedStudentId).trim()) {
                return { error: AUTHORIZED_MESSAGE, status: 403 };
            }
            const student = await getStudentForUser(user);
            return student ? { student } : { error: "Student profile not found", status: 404 };
        }

        if (user.role === "parent") {
            const parentId = Number(user.parent_id || user.id || 0);
            let studentId = Number(requestedStudentId || 0);
            if (!studentId) {
                const linked = await parentFamily.getLinkedStudentsForParentAsync(parentId);
                if (linked.length !== 1) return { error: linked.length ? "Please select a linked child before asking about private student information." : "No linked student is available for this parent account.", status: 400 };
                studentId = Number(linked[0].id);
            }
            const student = await parentFamily.getLinkedStudentByIdAsync(parentId, studentId);
            return student ? { student } : { error: AUTHORIZED_MESSAGE, status: 403 };
        }

        return { error: AUTHORIZED_MESSAGE, status: 403 };
    }

    async function results(user, message, requestedStudentId) {
        const target = await getAuthorizedStudent(user, requestedStudentId);
        if (target.error) return target;
        const semester = parseSemester(message);
        if (!semester) return { message: isTelugu(message) ? "ఏ సంవత్సరం మరియు సెమిస్టర్ ఫలితం కావాలి? ఉదాహరణకు 3-1." : "Please specify the year and semester, for example 3-1." };
        const rows = await queryAll(`
            SELECT subject, subject_code, total_marks, grade, pass_status
            FROM result_records
            WHERE student_id = ? AND year = ? AND semester = ? AND publication_status = 'Published'
            ORDER BY subject
            LIMIT 20
        `, [target.student.id, semester.year, semester.semester]);
        if (!rows.length) {
            const draft = await queryOne("SELECT 1 FROM result_records WHERE student_id = ? AND year = ? AND semester = ? LIMIT 1", [target.student.id, semester.year, semester.semester]);
            return { message: draft
                ? (isTelugu(message) ? `మీ ${semester.label} ఫలితం ఇంకా ప్రచురించలేదు.` : `Your ${semester.label} result is not published yet.`)
                : (isTelugu(message) ? "అభ్యర్థించిన ఫలితం KHIT ఫ్యామిలీ పోర్టల్‌లో అందుబాటులో లేదు." : "The requested result is not available in the KHIT Family Portal.") };
        }
        return { message: isTelugu(message) ? `మీ ${semester.label} ఫలితం అందుబాటులో ఉంది.` : `Your ${semester.label} result is available.`, data: { semester: semester.label, published: true, result: rows } };
    }

    async function attendance(user, message, requestedStudentId) {
        const target = await getAuthorizedStudent(user, requestedStudentId);
        if (target.error) return target;
        const subject = extractSubject(message);
        const rows = await queryAll(`
            SELECT subject, attendance_date, status
            FROM attendance WHERE student_id = ? ${subject ? "AND LOWER(subject) LIKE LOWER(?)" : ""}
            ORDER BY attendance_date DESC LIMIT 30
        `, subject ? [target.student.id, `%${subject}%`] : [target.student.id]);
        if (!rows.length) return { message: isTelugu(message) ? "హాజరు సమాచారం ప్రస్తుతం అందుబాటులో లేదు." : "Attendance information is currently unavailable." };
        const present = rows.filter(row => String(row.status).toLowerCase() === "present").length;
        return { message: isTelugu(message) ? `మీ హాజరు ${rows.length} నమోదుల్లో ${present} ప్రెజెంట్.` : `Your attendance is ${present} present out of ${rows.length} recent records.`, data: { recent: rows, present, records: rows.length, subject: subject || null } };
    }

    async function fees(user, _message, requestedStudentId) {
        const target = await getAuthorizedStudent(user, requestedStudentId);
        if (target.error) return target;
        const rows = await queryAll(`
            SELECT fee_year, academic_year, total_amount, paid_amount, pending_amount, status
            FROM fees WHERE student_id = ? ORDER BY fee_year DESC, id DESC LIMIT 20
        `, [target.student.id]);
        if (!rows.length) return { message: isTelugu(_message) ? "ఫీజు సమాచారం ప్రస్తుతం అందుబాటులో లేదు." : "Fee information is currently unavailable." };
        const summary = rows.reduce((result, row) => ({ total: result.total + toSafeNumber(row.total_amount), paid: result.paid + toSafeNumber(row.paid_amount), pending: result.pending + toSafeNumber(row.pending_amount) }), { total: 0, paid: 0, pending: 0 });
        return { message: isTelugu(_message) ? `మీ ఫీజు బకాయి ${summary.pending}.` : `Your fee balance is ${summary.pending}.`, data: { summary, fees: rows } };
    }

    async function notifications(user, _message, requestedStudentId) {
        if (!["student", "parent"].includes(user.role)) {
            const scope = await officialScope(user, ["notifications.view", "department.notifications.read"], requestedStudentId);
            if (scope.error) return scope;
            const branchFilter = scope.department ? "OR branch IN (?, ?)" : "";
            const branchParams = scope.department ? [scope.department, scope.department] : [];
            const rows = await queryAll(`
                SELECT title, message, created_at
                FROM notifications
                WHERE audience = 'All' OR audience = 'All Students'
                   ${branchFilter}
                ORDER BY created_at DESC LIMIT 10
            `, branchParams);
            if (!rows.length) return { message: isTelugu(_message) ? "సంబంధిత అధికారిక నోటిఫికేషన్ అందుబాటులో లేదు." : "No relevant official notification is available." };
            const formatted = formatOfficialItems(rows, "notification", _message, row => ({ extra: row.message ? String(row.message).slice(0, 90) : null }));
            return { ...formatted, data: { notifications: rows } };
        }
        const target = await getAuthorizedStudent(user, requestedStudentId);
        if (target.error) return target;
        const rows = await queryAll(`
            SELECT title, message, created_at
            FROM notifications
            WHERE audience IN ('All', 'All Students', 'Parents')
               OR (audience = 'Branch' AND branch = ?)
               OR (audience = 'Year' AND year = ?)
               OR (audience = 'Section' AND section = ?)
            ORDER BY created_at DESC LIMIT 10
        `, [target.student.department, target.student.year, target.student.section]);
        if (!rows.length) return { message: isTelugu(_message) ? "సంబంధిత అధికారిక నోటిఫికేషన్ అందుబాటులో లేదు." : "No relevant official notification is available." };
        const formatted = formatOfficialItems(rows, "notification", _message, row => ({ extra: row.message ? String(row.message).slice(0, 90) : null }));
        return { ...formatted, data: { notifications: rows } };
    }

    async function officialScope(user, permission, requestedStudentId) {
        if (["student", "parent"].includes(user.role)) {
            const target = await getAuthorizedStudent(user, requestedStudentId);
            return target.error ? target : { target };
        }
        const scope = String(user.scope || departmentHierarchy.getRoleScope(user.role)).toUpperCase();
        const permissions = Array.isArray(permission) ? permission : [permission];
        if (!permissions.some((item) => departmentHierarchy.hasRolePermission(user, item) || departmentHierarchy.hasRolePermission(user, item.replace("department.", "")))) {
            return { error: AUTHORIZED_MESSAGE, status: 403 };
        }
        return { management: true, department: scope === "DEPARTMENT" ? user.department_code : null };
    }

    async function announcements(user, message, requestedStudentId) {
        const scope = await officialScope(user, ["announcements.view", "announcements.manage"], requestedStudentId);
        if (scope.error) return scope;
        const audience = scope.target ? (user.role === "parent" ? "('All', 'All Students', 'Parents')" : "('All', 'All Students')") : "('All', 'All Students')";
        const rows = await queryAll(`SELECT title, description, category, link_url, published_at, created_at FROM announcements WHERE published = ${usePostgres ? "TRUE" : "1"} AND audience IN ${audience} ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 10`);
        if (!rows.length) return { message: isTelugu(message) ? "పోర్టల్‌లో అధికారిక ప్రకటన సమాచారం ప్రస్తుతం అందుబాటులో లేదు." : "No official announcement information is currently available in the portal." };
        const formatted = formatOfficialItems(rows, "announcement", message, row => ({ extra: row.category }));
        return { ...formatted, data: { announcements: rows } };
    }

    async function eventsForUser(user, message) {
        const canReadEvents = ["student", "parent"].includes(user.role) || departmentHierarchy.hasRolePermission(user, "events.view");
        if (!canReadEvents) return { error: AUTHORIZED_MESSAGE, status: 403 };
        const rows = await queryAll(`SELECT title, description, event_date, event_time, venue, category FROM events WHERE published = ${usePostgres ? "TRUE" : "1"} AND (audience = 'All' OR audience IS NULL) ORDER BY event_date ASC, id ASC LIMIT 20`);
        if (!rows.length) return { message: isTelugu(message) ? "అధికారిక కళాశాల ఈవెంట్ సమాచారం ప్రస్తుతం అందుబాటులో లేదు." : "No official college event information is currently available." };
        const formatted = formatOfficialItems(rows, "event", message, row => ({ extra: [row.event_time, row.venue].filter(Boolean).join(" at ") }));
        return { ...formatted, data: { events: rows } };
    }

    async function materials(user, message, requestedStudentId) {
        const scope = await officialScope(user, ["study_materials.view", "department.materials.read"], requestedStudentId);
        if (scope.error) return scope;
        if (!scope.target && !scope.management) return { error: AUTHORIZED_MESSAGE, status: 403 };
        const student = scope.target?.student;
        const conditions = [];
        const params = [];
        if (student?.department || scope.department) {
            conditions.push("(department IS NULL OR department = ?)");
            params.push(student?.department || scope.department);
        }
        if (student?.year) {
            conditions.push("(year IS NULL OR year = ?)");
            params.push(student.year);
        }
        if (student?.section) {
            conditions.push("(section IS NULL OR section = ?)");
            params.push(student.section);
        }
        const rows = await queryAll(`
            SELECT title, description, material_type, file_url, subject, department, year, section, created_at
            FROM study_materials
            ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
            ORDER BY created_at DESC, id DESC LIMIT 20
        `, params);
        if (!rows.length) return { message: isTelugu(message) ? "మీ అనుమతించబడిన పరిధికి అధ్యయన సామగ్రి ప్రస్తుతం అందుబాటులో లేదు." : "No study materials are currently available for your authorized portal view." };
        const formatted = formatOfficialItems(rows, "study material", message, row => ({ extra: [row.subject, row.material_type].filter(Boolean).join(" | ") }));
        return { ...formatted, data: { materials: rows } };
    }

    async function documents(user, message, requestedStudentId) {
        const scope = await officialScope(user, "documents.view", requestedStudentId);
        if (scope.error) return scope;
        const student = scope.target?.student;
        const rows = await queryAll(`
            SELECT d.title AS document_name, d.category AS document_type, d.created_at AS uploaded_at
            FROM documents d
            ${student ? "WHERE d.visibility = 'Public' OR d.student_id = ?" : "WHERE d.visibility = 'Public'"}
            ORDER BY d.created_at DESC, d.id DESC LIMIT 20
        `, student ? [student.id] : []);
        if (!rows.length) return { message: isTelugu(message) ? "అధికారిక పత్రాలు ప్రస్తుతం అందుబాటులో లేవు." : "No official documents are currently available in the portal." };
        const formatted = formatOfficialItems(rows, "document", message, () => ({}));
        return { ...formatted, data: { documents: rows } };
    }

    async function assignments(user, _message, requestedStudentId) {
        const target = await getAuthorizedStudent(user, requestedStudentId);
        if (target.error) return target;
        const rows = await queryAll(`
            SELECT a.title, a.description, a.deadline AS due_date, s.name AS subject_name
            FROM assignments a LEFT JOIN subjects s ON s.id = a.subject_id
            WHERE s.id IS NULL OR (s.department = ? AND (s.year IS NULL OR s.year = ?) AND (s.section IS NULL OR s.section = ?))
            ORDER BY a.deadline, a.id DESC LIMIT 20
        `, [target.student.department, target.student.year, target.student.section]);
        if (!rows.length) return { message: isTelugu(_message) ? "అసైన్‌మెంట్ సమాచారం ప్రస్తుతం అందుబాటులో లేదు." : "Assignment information is currently unavailable." };
        return { message: isTelugu(_message) ? `మీ అకడమిక్ సందర్భానికి ${rows.length} అసైన్‌మెంట్లు కనిపించాయి.` : `I found ${rows.length} assignments for your academic context.`, data: { assignments: rows } };
    }

    async function events(user, message) {
        const canReadEvents = ["student", "parent"].includes(user.role) || departmentHierarchy.hasRolePermission(user, "events.view");
        if (!canReadEvents) return { error: AUTHORIZED_MESSAGE, status: 403 };
        const rows = await queryAll(`
            SELECT title, description, event_date, event_time, venue, category
            FROM events WHERE published = TRUE AND (audience = 'All' OR audience IS NULL)
            ORDER BY event_date DESC, id DESC LIMIT 20
        `);
        if (!rows.length) return { message: isTelugu(message) ? "అధికారిక కళాశాల ఈవెంట్ ప్రస్తుతం అందుబాటులో లేదు." : "No official college event is currently available." };
        return { message: isTelugu(message) ? `${rows.length} అధికారిక కళాశాల ఈవెంట్లు కనిపించాయి.` : `I found ${rows.length} official college event${rows.length === 1 ? "" : "s"}.`, data: { events: rows } };
    }

    async function handle({ user, message, studentId }) {
        const normalized = normalizeMessage(message);
        if (!normalized) return { error: "A question is required.", status: 400 };
        let intent = detectIntent(normalized);
        const contextKey = `${user.role}:${user.id}:${user.parent_id || ""}:${studentId || ""}`;
        const prior = followUpContext.get(contextKey);
        if (intent === "followup" && prior?.items?.length) {
            const index = ordinalIndex(normalized);
            if (index === null || !prior.items[index]) {
                return { intent: "followup", message: isTelugu(normalized) ? "మునుపటి అధికారిక జాబితాలో ఏ అంశాన్ని వివరించాలో చెప్పండి." : "Please specify an item from the previous official list." };
            }
            const item = prior.items[index];
            const details = [item.summary, item.date, item.extra].filter(Boolean).join(" | ");
            return { intent: prior.intent, message: isTelugu(normalized) ? `${item.title} గురించి: ${details || "వివరాలు ప్రస్తుతం అందుబాటులో లేవు."}` : `${item.title}: ${details || "More details are not currently available in the portal."}` };
        }
        if (intent === "followup" && prior?.intent && ["notifications", "events", "announcements", "materials", "documents"].includes(prior.intent) && !prior.items?.length) {
            return { intent: "followup", message: isTeluguLike(normalized) ? "మునుపటి జాబితాలో వివరించడానికి అధికారిక అంశం అందుబాటులో లేదు." : "There is no matching official item to explain from the previous list." };
        }
        if (intent === "followup" && prior?.intent === "results") intent = "results";
        if (intent === "outside" && prior?.intent === "attendance" && extractSubject(normalized)) intent = "attendance";
        if (intent === "protected") return { intent, error: AUTHORIZED_MESSAGE, status: 403 };
        if (intent === "outside") return { intent, message: CLOSED_DOMAIN_MESSAGE };
        if (intent === "followup") return { intent: "results", message: isTelugu(normalized) ? "ఏ సెమిస్టర్ ఫలితం చూడాలి?" : "Which semester result would you like me to check?" };
        const handler = { results, attendance, fees, notifications, announcements, events: eventsForUser, assignments, materials, documents }[intent];
        if (!handler) return { intent, message: CLOSED_DOMAIN_MESSAGE };
        const result = await handler(user, normalized, studentId);
        followUpContext.set(contextKey, { intent, items: result.items || [], at: Date.now() });
        for (const [key, value] of followUpContext) if (Date.now() - value.at > 10 * 60 * 1000) followUpContext.delete(key);
        return { intent, ...result };
    }

    return { handle, normalizeMessage, detectIntent };
}

module.exports = { createKhitAiService, CLOSED_DOMAIN_MESSAGE, AUTHORIZED_MESSAGE };
