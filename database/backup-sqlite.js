const fs = require("fs");
const path = require("path");

const databaseDirectory = __dirname;
const sourceFiles = ["khit_family.db", "khit_family.db-shm", "khit_family.db-wal"];
const backupDirectory = path.join(__dirname, "..", "backups", new Date().toISOString().replace(/[:.]/g, "-"));

fs.mkdirSync(backupDirectory, { recursive: true });

for (const fileName of sourceFiles) {
    const sourcePath = path.join(databaseDirectory, fileName);
    if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, path.join(backupDirectory, fileName));
    }
}

const uploadsDirectory = path.join(__dirname, "..", "uploads");
if (fs.existsSync(uploadsDirectory)) {
    fs.cpSync(uploadsDirectory, path.join(backupDirectory, "uploads"), { recursive: true });
}

console.log(`SQLite backup created at ${backupDirectory}`);