const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

require("dotenv").config();

const rootDirectory = __dirname;
const productionMode = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const errors = [];
const warnings = [];
const localCompatibilityRoutes = new Set([
    "/api/login",
    "/api/admin/login",
    "/api/parent/dashboard",
    "/api/parent/student-profile",
    "/api/student/academics",
    "/api/student/fees/pay",
    "/api/student/leave-requests",
    "/api/student/profile"
]);

function fail(message) {
    errors.push(message);
}

function warn(message) {
    warnings.push(message);
}

function checkJavaScriptSyntax() {
    const javascriptFiles = fs.readdirSync(rootDirectory)
        .filter(fileName => fileName.endsWith(".js"))
        .map(fileName => path.join(rootDirectory, fileName));

    for (const filePath of javascriptFiles) {
        try {
            execFileSync(process.execPath, ["--check", filePath], { stdio: "ignore" });
        } catch (_error) {
            fail(`JavaScript syntax check failed: ${path.basename(filePath)}`);
        }
    }
}

function checkFrontendLinks() {
    const htmlFiles = fs.readdirSync(rootDirectory)
        .filter(fileName => fileName.endsWith(".html"));
    const missingFiles = new Set();

    for (const fileName of htmlFiles) {
        const source = fs.readFileSync(path.join(rootDirectory, fileName), "utf8");
        for (const match of source.matchAll(/(?:href|src)=["']([^"'#?]+)["']/gi)) {
            const referencedPath = match[1];
            if (!referencedPath.endsWith(".html")) continue;
            if (!fs.existsSync(path.join(rootDirectory, referencedPath))) {
                missingFiles.add(`${fileName} -> ${referencedPath}`);
            }
        }
    }

    for (const missingFile of missingFiles) fail(`Missing frontend file: ${missingFile}`);
}

function checkEnvironment() {
    if (!productionMode) {
        warn("NODE_ENV is not production; production environment checks were not enforced.");
    } else {
        for (const variable of ["JWT_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD", "DATABASE_URL", "FRONTEND_URL"]) {
            if (!String(process.env[variable] || "").trim()) fail(`Missing required production variable: ${variable}`);
        }

        const storageProvider = String(process.env.STORAGE_PROVIDER || process.env.UPLOAD_STORAGE || "local").toLowerCase();
        if (["local", "filesystem", "disk"].includes(storageProvider)) {
            fail("Production uploads use local storage; configure a durable object-storage adapter before deployment.");
        } else if (["s3", "object-storage", "cloud"].includes(storageProvider)) {
            for (const variable of ["S3_BUCKET", "S3_REGION"]) {
                if (!String(process.env[variable] || "").trim()) fail(`Missing required production storage variable: ${variable}`);
            }
        }
    }

    const serverSource = fs.readFileSync(path.join(rootDirectory, "server.js"), "utf8");
    const routePattern = /app\.(?:get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g;
    const sqlitePattern = /\bdb\.(?:prepare|exec|pragma)\s*\(/g;
    const routes = [...serverSource.matchAll(routePattern)].map(match => ({
        path: match[1],
        index: match.index
    }));
    const productionRouteCounts = new Map();
    let totalSqliteCalls = 0;
    let routeSqliteCalls = 0;
    let compatibilityRouteCalls = 0;

    for (const match of serverSource.matchAll(sqlitePattern)) {
        totalSqliteCalls += 1;
        const route = routes.filter(candidate => candidate.index < match.index).at(-1)?.path;
        if (!route || route === "/api/health" || route === "/api/status" || localCompatibilityRoutes.has(route)) continue;
        routeSqliteCalls += 1;
        productionRouteCounts.set(route, (productionRouteCounts.get(route) || 0) + 1);
    }

    for (const match of serverSource.matchAll(sqlitePattern)) {
        const route = routes.filter(candidate => candidate.index < match.index).at(-1)?.path;
        if (route && localCompatibilityRoutes.has(route)) compatibilityRouteCalls += 1;
    }

    if (productionRouteCounts.size) {
        const routeSummary = [...productionRouteCounts.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([route, count]) => `${route} (${count})`)
            .join(", ");
        fail(`Production routes still contain ${[...productionRouteCounts.values()].reduce((sum, count) => sum + count, 0)} direct SQLite calls: ${routeSummary}.`);
    }
    console.log(`SQLite inventory: ${totalSqliteCalls} direct calls; ${routeSqliteCalls} production-route calls across ${productionRouteCounts.size} routes; ${compatibilityRouteCalls} guarded local-compatibility calls; ${totalSqliteCalls - routeSqliteCalls - compatibilityRouteCalls} startup/helper calls.`);
}

checkEnvironment();
checkJavaScriptSyntax();
checkFrontendLinks();

for (const warning of warnings) console.warn(`WARN: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);

if (errors.length) {
    console.error(`Production readiness failed with ${errors.length} error(s).`);
    process.exitCode = 1;
} else {
    console.log("Production readiness checks passed.");
}