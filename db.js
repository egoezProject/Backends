const crypto = require('crypto');
const { Pool } = require('pg');

let pool = null;
function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
    }
    return pool;
}

const DEFAULT_DB = {
    users: [
        {
            id: 'admin',
            username: 'admin',
            password: '123',
            role: 'admin',
            createdAt: Date.now()
        }
    ],
    clients: [],
    jwts: [],
    pending_approvals: []
};

async function initDbAsync() {
    await getPool().query(`
        CREATE TABLE IF NOT EXISTS store (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL
        )
    `);

    // Seed default data if table is empty
    const res = await getPool().query(`SELECT key FROM store WHERE key = 'db'`);
    if (res.rowCount === 0) {
        await getPool().query(
            `INSERT INTO store (key, value) VALUES ('db', $1)`,
            [JSON.stringify(DEFAULT_DB)]
        );
    }
}

function initDb() {
    initDbAsync().catch(err => console.error('DB Init Error:', err));
}

function readDb() {
    // Supabase is async but index.js calls readDb() synchronously.
    // We cache the last known state and refresh it asynchronously.
    if (!readDb._cache) {
        readDb._cache = { ...DEFAULT_DB };
        // Trigger async load immediately
        getPool().query(`SELECT value FROM store WHERE key = 'db'`)
            .then(res => {
                if (res.rowCount > 0) {
                    readDb._cache = { ...DEFAULT_DB, ...res.rows[0].value };
                }
            })
            .catch(err => console.error('DB Read Error:', err));
    }
    return readDb._cache;
}

// Also expose an async version for internal use
readDb.refresh = async function () {
    const res = await getPool().query(`SELECT value FROM store WHERE key = 'db'`);
    if (res.rowCount > 0) {
        readDb._cache = { ...DEFAULT_DB, ...res.rows[0].value };
    }
    return readDb._cache;
};

function writeDb(data) {
    readDb._cache = data;
    getPool().query(
        `INSERT INTO store (key, value) VALUES ('db', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(data)]
    ).catch(err => console.error('DB Write Error:', err));
}

function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

module.exports = {
    initDb,
    readDb,
    writeDb,
    generateId
};
