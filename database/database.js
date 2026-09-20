const Database = require("better-sqlite3");
const path = require("path");

// Database file location
const dbPath = path.join(__dirname, "khit_family.db");

// Connect to SQLite database
const db = new Database(dbPath);

// Enable foreign keys
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// Better SQLite performance
db.pragma("journal_mode = WAL");

console.log("KHIT Family Database connected successfully!");

module.exports = db;