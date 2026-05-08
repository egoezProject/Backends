const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'db.json');

const DEFAULT_DB = {
    users: [
        {
            id: 'admin',
            username: 'admin',
            password: '123', // Admin can change this or we can hash later. Kept simple per limits.
            role: 'admin',
            createdAt: Date.now()
        }
    ],
    clients: [], // { id, hardwareId, assignedName, osInfo, firstConnection, lastConnection, ownerId }
    jwts: [], // { code, clientId, status: 'active'|'used'|'revoked', createdBy, createdAt, usedBy, usedAt }
    pending_approvals: [] // { id, jwtCode, clientId, userId, requestedAt }
};

function initDb() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 4));
    }
}

function readDb() {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(data);
        return { ...DEFAULT_DB, ...parsed };
    } catch (err) {
        console.error("DB Read Error:", err);
        return DEFAULT_DB;
    }
}

function writeDb(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4));
    } catch (err) {
        console.error("DB Write Error:", err);
    }
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
