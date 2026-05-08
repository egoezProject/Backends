const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
const db = require('./db');
require('dotenv').config();

db.initDb();

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend automatically!
app.use(express.static(path.join(__dirname, './dist')));

// Basic Auth Middleware for APIs
function auth(req, res, next) {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: 'No token' });
    const database = db.readDb();
    const user = database.users.find(u => u.id === token); // Using user.id as token for simplicity
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
}

// REST APIs
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const database = db.readDb();
    const user = database.users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ token: user.id, role: user.role, username: user.username });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.get('/api/auth/me', auth, (req, res) => {
    res.json({ id: req.user.id, role: req.user.role, username: req.user.username });
});

// Admin: Get all clients
app.get('/api/admin/clients', auth, adminOnly, (req, res) => {
    const database = db.readDb();
    res.json(database.clients);
});

// Admin: Generate JWT for a client
app.post('/api/admin/jwt', auth, adminOnly, (req, res) => {
    const { clientId } = req.body;
    const database = db.readDb();
    const client = database.clients.find(c => c.id === clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const code = 'JWT-' + db.generateId().toUpperCase();
    const newJwt = {
        code,
        clientId,
        status: 'active',
        createdBy: req.user.id,
        createdAt: Date.now(),
        usedBy: null,
        usedAt: null
    };
    database.jwts.push(newJwt);
    db.writeDb(database);
    res.json(newJwt);
});

// User: Claim a client using JWT
app.post('/api/claim', auth, (req, res) => {
    const { code } = req.body;
    const database = db.readDb();
    const jwtIndex = database.jwts.findIndex(j => j.code === code && j.status === 'active');
    
    if (jwtIndex === -1) return res.status(400).json({ error: 'Invalid or already used code' });
    
    // Mark as pending
    database.jwts[jwtIndex].status = 'pending';
    
    const approval = {
        id: db.generateId(),
        jwtCode: code,
        clientId: database.jwts[jwtIndex].clientId,
        userId: req.user.id,
        requestedAt: Date.now()
    };
    database.pending_approvals.push(approval);
    db.writeDb(database);
    
    res.json({ message: 'Claim request sent to admin for approval.', approvalId: approval.id });
});

// Admin: Approve/Reject claim
app.post('/api/admin/approve', auth, adminOnly, (req, res) => {
    const { approvalId, approve } = req.body;
    const database = db.readDb();
    
    const approvalIndex = database.pending_approvals.findIndex(a => a.id === approvalId);
    if (approvalIndex === -1) return res.status(404).json({ error: 'Approval request not found' });
    
    const approval = database.pending_approvals[approvalIndex];
    const jwtIndex = database.jwts.findIndex(j => j.code === approval.jwtCode);
    
    if (approve) {
        // Grant ownership
        const clientIndex = database.clients.findIndex(c => c.id === approval.clientId);
        if (clientIndex !== -1) {
            database.clients[clientIndex].ownerId = approval.userId;
            database.clients[clientIndex].assignedName = req.body.assignedName || database.clients[clientIndex].hostname;
            
            // Update in-memory WebSocket client
            for (let [ws, meta] of activeConnections.entries()) {
                if (meta.type === 'agent' && meta.client.id === approval.clientId) {
                    meta.client.ownerId = approval.userId;
                    meta.client.assignedName = database.clients[clientIndex].assignedName;
                }
            }
        }
        
        // Add to user's ownedClients list in DB
        const userIndex = database.users.findIndex(u => u.id === approval.userId);
        if (userIndex !== -1) {
            if (!database.users[userIndex].ownedClients) {
                database.users[userIndex].ownedClients = [];
            }
            if (!database.users[userIndex].ownedClients.includes(approval.clientId)) {
                database.users[userIndex].ownedClients.push(approval.clientId);
            }
        }

        if(jwtIndex !== -1) {
            database.jwts[jwtIndex].status = 'used';
            database.jwts[jwtIndex].usedBy = approval.userId;
            database.jwts[jwtIndex].usedAt = Date.now();
        }
    } else {
        // Reject
        if(jwtIndex !== -1) {
            database.jwts[jwtIndex].status = 'revoked';
        }
    }
    
    // Remove pending approval
    database.pending_approvals.splice(approvalIndex, 1);
    db.writeDb(database);
    
    res.json({ success: true, approved: approve });
});

// Admin: Get pending approvals
app.get('/api/admin/approvals', auth, adminOnly, (req, res) => {
    const database = db.readDb();
    res.json(database.pending_approvals);
});

// Admin: Get all users
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
    const database = db.readDb();
    // Don't send passwords
    const safeUsers = database.users.map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }));
    res.json(safeUsers);
});

// Admin: Create new user
app.post('/api/admin/users', auth, adminOnly, (req, res) => {
    const { username, password, role } = req.body;
    const database = db.readDb();
    
    if (database.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    
    const newUser = {
        id: db.generateId(),
        username,
        password,
        role: role === 'admin' ? 'admin' : 'user',
        ownedClients: [],
        createdAt: Date.now()
    };
    
    database.users.push(newUser);
    db.writeDb(database);
    res.json({ success: true, user: { id: newUser.id, username: newUser.username, role: newUser.role } });
});

// --- WebSocket Setup ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Store active connections with their meta info
const activeConnections = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const type = url.searchParams.get('type') || 'unknown';
    const token = url.searchParams.get('token'); // User ID or Agent ID
    
    let connectionMeta = { type, ws, isAuth: false };
    const database = db.readDb();

    if (type === 'frontend') {
        const user = database.users.find(u => u.id === token);
        if (!user) {
            ws.close(4001, 'Unauthorized');
            return;
        }
        connectionMeta.isAuth = true;
        connectionMeta.user = user;
        activeConnections.set(ws, connectionMeta);
        console.log(`User ${user.username} connected via UI.`);
    } 
    else if (type === 'agent') {
        const hwid = url.searchParams.get('hwid'); // Hardware ID must be provided
        const hostname = url.searchParams.get('hostname');
        
        if (!hwid) {
            ws.close(4000, 'Hardware ID required');
            return;
        }
        
        // Register or update client in DB
        let client = database.clients.find(c => c.hardwareId === hwid);
        if (!client) {
            client = {
                id: db.generateId(),
                hardwareId: hwid,
                hostname: hostname,
                assignedName: null,
                firstConnection: Date.now(),
                lastConnection: Date.now(),
                ownerId: null,
                osInfo: {}
            };
            database.clients.push(client);
        } else {
            client.lastConnection = Date.now();
            client.hostname = hostname; // update just in case
        }
        db.writeDb(database);
        
        connectionMeta.isAuth = true;
        connectionMeta.client = client;
        activeConnections.set(ws, connectionMeta);
        console.log(`Agent ${client.hostname} (${client.id}) connected.`);
    } else {
        ws.close(4002, 'Unknown connection type');
        return;
    }

    ws.on('message', (message) => {
        const meta = activeConnections.get(ws);
        if (!meta || !meta.isAuth) return;

        try {
            const data = JSON.parse(message.toString());
            
            // AGENT TO FRONTEND
            if (meta.type === 'agent') {
                const clientId = meta.client.id;
                const ownerId = meta.client.ownerId; // Who owns this client?

                // Add clientId to the payload so frontend knows where it came from
                if(data.payload) data.payload.clientId = clientId;

                // Broadcast to eligible frontends
                for (let [clientWs, clientMeta] of activeConnections.entries()) {
                    if (clientMeta.type === 'frontend' && clientWs.readyState === 1) {
                        // Admin sees everything. Users see only their owned clients.
                        if (clientMeta.user.role === 'admin' || clientMeta.user.id === ownerId) {
                            clientWs.send(JSON.stringify(data));
                        }
                        // Ajanın gönderdiği internal AGENT_ID'yi (payload.id) sunucunun hafızasına kaydet
                        if(data.payload && data.payload.id) {
                            meta.agentId = data.payload.id;
                        }
                    }
                }
            }
            
            // FRONTEND TO AGENT
            else if (meta.type === 'frontend') {
                // Determine target agent
                const targetAgentId = data.payload?.agentId || data.payload?.clientId;
                if (!targetAgentId && data.event !== 'request_heartbeats') return; // Broadcasts not allowed for targeted commands unless specific
                
                for (let [agentWs, agentMeta] of activeConnections.entries()) {
                    if (agentMeta.type === 'agent' && agentWs.readyState === 1) {
                        
                        // If it's a global request like heartbeats
                        if (data.event === 'request_heartbeats') {
                            if (meta.user.role === 'admin' || agentMeta.client.ownerId === meta.user.id) {
                                agentWs.send(message.toString());
                            }
                            continue;
                        }

                        // Specific target
                        if (agentMeta.client.id === targetAgentId || agentMeta.agentId === targetAgentId) {
                            if (meta.user.role === 'admin' || agentMeta.client.ownerId === meta.user.id) {
                                agentWs.send(message.toString());
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore parse errors from raw messages
        }
    });

    ws.on('close', () => {
        activeConnections.delete(ws);
    });
});

const PORT = process.env.PORT || 443;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`⚡ Merkez Sunucu ve Arayüz ${PORT} portunda başarıyla başlatıldı!`);
});
