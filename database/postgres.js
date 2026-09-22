const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const { Pool } = require("pg");

const databaseUrl = process.env.DATABASE_URL || null;
const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
const useSsl = process.env.PGSSL !== "false";

function createDisabledPool() {
    const disabledPool = {
        async query() {
            throw new Error("PostgreSQL is not configured. Set DATABASE_URL for the PostgreSQL runtime, or keep SQLite for local development.");
        },
        async connect() {
            throw new Error("PostgreSQL is not configured. Set DATABASE_URL for the PostgreSQL runtime, or keep SQLite for local development.");
        },
        on() {
            return undefined;
        }
    };

    return disabledPool;
}

if (!databaseUrl && isProduction) {
    throw new Error("DATABASE_URL is required in production mode for the PostgreSQL connection pool");
}

const pool = databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
        ssl: useSsl ? { rejectUnauthorized: false } : false
    })
    : createDisabledPool();

if (databaseUrl) {
    pool.on("error", (error) => {
        console.error("Unexpected PostgreSQL pool error:", error.message);
    });
} else {
    console.info("PostgreSQL runtime disabled for SQLite local development mode.");
}

module.exports = pool;