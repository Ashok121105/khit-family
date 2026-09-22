const pool = require("./postgres");

/**
 * Convert SQLite-style positional placeholders only when they are outside SQL
 * strings/comments and the number of placeholders matches the parameters.
 * This is a transitional aid for one query at a time; it is not a global SQL
 * rewrite and does not convert identifiers, SQL functions, or SQLite syntax.
 */
function convertQuestionPlaceholders(sql, parameters = []) {
    if (typeof sql !== "string") {
        throw new TypeError("SQL must be a string");
    }
    if (!Array.isArray(parameters)) {
        throw new TypeError("Query parameters must be an array");
    }

    const hasQuestionMark = sql.includes("?");
    const hasPostgresPlaceholder = /\$\d+/.test(sql);
    if (!hasQuestionMark) {
        if (parameters.length && !hasPostgresPlaceholder) {
            throw new Error("Parameters were supplied but SQL has no placeholders");
        }
        return sql;
    }
    if (hasPostgresPlaceholder) {
        throw new Error("SQL cannot mix SQLite and PostgreSQL placeholders");
    }

    let result = "";
    let parameterIndex = 0;
    let state = "normal";
    let dollarQuoteTag = null;

    for (let index = 0; index < sql.length; index += 1) {
        const character = sql[index];
        const nextCharacter = sql[index + 1];

        if (state === "line-comment") {
            result += character;
            if (character === "\n") state = "normal";
            continue;
        }
        if (state === "block-comment") {
            result += character;
            if (character === "*" && nextCharacter === "/") {
                result += nextCharacter;
                index += 1;
                state = "normal";
            }
            continue;
        }
        if (state === "single-quote") {
            result += character;
            if (character === "'" && nextCharacter === "'") {
                result += nextCharacter;
                index += 1;
            } else if (character === "'") {
                state = "normal";
            }
            continue;
        }
        if (state === "double-quote") {
            result += character;
            if (character === '"' && nextCharacter === '"') {
                result += nextCharacter;
                index += 1;
            } else if (character === '"') {
                state = "normal";
            }
            continue;
        }
        if (state === "dollar-quote") {
            result += character;
            if (sql.startsWith(dollarQuoteTag, index)) {
                result += sql.slice(index + 1, index + dollarQuoteTag.length);
                index += dollarQuoteTag.length - 1;
                state = "normal";
                dollarQuoteTag = null;
            }
            continue;
        }

        if (character === "-" && nextCharacter === "-") {
            result += "--";
            index += 1;
            state = "line-comment";
        } else if (character === "/" && nextCharacter === "*") {
            result += "/*";
            index += 1;
            state = "block-comment";
        } else if (character === "'") {
            result += character;
            state = "single-quote";
        } else if (character === '"') {
            result += character;
            state = "double-quote";
        } else if (character === "$" && sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/)) {
            const tagMatch = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/);
            dollarQuoteTag = tagMatch[0];
            result += dollarQuoteTag;
            index += dollarQuoteTag.length - 1;
            state = "dollar-quote";
        } else if (character === "?") {
            parameterIndex += 1;
            result += `$${parameterIndex}`;
        } else {
            result += character;
        }
    }

    if (state === "single-quote" || state === "double-quote" || state === "block-comment" || state === "dollar-quote") {
        throw new Error("SQL contains an unterminated quoted string or comment");
    }
    if (parameterIndex !== parameters.length) {
        throw new Error(
            `SQL placeholder count (${parameterIndex}) does not match parameter count (${parameters.length})`
        );
    }

    return result;
}

function normalizeQuery(sql, parameters) {
    const values = parameters || [];
    return {
        text: convertQuestionPlaceholders(sql, values),
        values
    };
}

class PostgreSQLTransaction {
    constructor(client) {
        this.client = client;
    }

    query(sql, parameters = []) {
        const query = normalizeQuery(sql, parameters);
        return this.client.query(query);
    }

    async get(sql, parameters = []) {
        const result = await this.query(sql, parameters);
        return result.rows[0];
    }

    async all(sql, parameters = []) {
        const result = await this.query(sql, parameters);
        return result.rows;
    }

    async run(sql, parameters = []) {
        const result = await this.query(sql, parameters);
        return {
            changes: result.rowCount,
            rows: result.rows,
            lastInsertRowid: result.rows[0]?.id
        };
    }

    async exec(sql) {
        if (arguments.length > 1) {
            throw new Error("exec does not accept parameters; use query/get/all/run instead");
        }
        return this.client.query(sql);
    }
}

const postgresAdapter = {
    query(sql, parameters = []) {
        const query = normalizeQuery(sql, parameters);
        return pool.query(query);
    },

    async get(sql, parameters = []) {
        const result = await this.query(sql, parameters);
        return result.rows[0];
    },

    async all(sql, parameters = []) {
        const result = await this.query(sql, parameters);
        return result.rows;
    },

    async run(sql, parameters = []) {
        const result = await this.query(sql, parameters);
        return {
            changes: result.rowCount,
            rows: result.rows,
            lastInsertRowid: result.rows[0]?.id
        };
    },

    async exec(sql) {
        if (arguments.length > 1) {
            throw new Error("exec does not accept parameters; use query/get/all/run instead");
        }
        return pool.query(sql);
    },

    async beginTransaction() {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            return {
                db: new PostgreSQLTransaction(client),
                async commit() {
                    await client.query("COMMIT");
                    client.release();
                },
                async rollback() {
                    try {
                        await client.query("ROLLBACK");
                    } finally {
                        client.release();
                    }
                }
            };
        } catch (error) {
            client.release();
            throw error;
        }
    },

    async transaction(callback) {
        const transaction = await this.beginTransaction();
        try {
            const result = await callback(transaction.db);
            await transaction.commit();
            return result;
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },

    pool
};

module.exports = {
    ...postgresAdapter,
    convertQuestionPlaceholders
};
