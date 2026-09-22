function createKhitAiTools({ db, postgres, usePostgres }) {
    async function queryOne(sql, params = []) {
        return usePostgres ? postgres.get(sql, params) : db.prepare(sql).get(...params);
    }

    async function queryAll(sql, params = []) {
        return usePostgres ? postgres.all(sql, params) : db.prepare(sql).all(...params);
    }

    return { queryOne, queryAll };
}

module.exports = { createKhitAiTools };
