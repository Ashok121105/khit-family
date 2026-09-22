const pool = require("./postgres");

async function testPostgresConnection() {
    const client = await pool.connect();

    try {
        const result = await client.query("SELECT 1 AS connected");
        if (result.rows[0]?.connected !== 1) {
            throw new Error("PostgreSQL connection test returned an unexpected result");
        }
        console.log("PostgreSQL connection successful.");
    } finally {
        client.release();
        await pool.end();
    }
}

testPostgresConnection().catch(async (error) => {
    console.error("PostgreSQL connection failed:", error.message);
    await pool.end().catch(() => {});
    process.exitCode = 1;
});