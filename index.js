const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());

// Serve the frontend automatically!
app.use(express.static(path.join(__dirname, '../frontend/dist')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const SECRET_KEY = process.env.SECRET_KEY || "admin123";

wss.on('connection', (ws, req) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        
        if (token !== SECRET_KEY) {
            console.log(`Unauthorized connection attempt`);
            ws.close();
            return;
        }

        const type = url.searchParams.get('type') || 'unknown';
        console.log(`${type.toUpperCase()} connected. Total clients: ${wss.clients.size}`);

        ws.on('message', (message) => {
            // Cihaz kısıtlamamız kalmadığına göre (Node.js) gelen veriyi doğrudan
            // hiç bozmadan tüm diğer bağlı kullanıcılara iletiyoruz.
            wss.clients.forEach(function each(client) {
                if (client !== ws && client.readyState === 1) { // 1 = OPEN
                    client.send(message.toString());
                }
            });
        });

        ws.on('close', () => {
            console.log(`${type.toUpperCase()} disconnected`);
        });

        ws.on('error', (err) => {
            console.error('WS Error:', err);
        });
    } catch (e) {
        console.error(e);
        ws.close();
    }
});

const PORT = process.env.PORT || 5902;
server.listen(PORT, () => {
    console.log(`⚡ Merkez Sunucu ve Arayüz ${PORT} portunda başarıyla başlatıldı!`);
    console.log(`🌐 Arayüze ulaşmak için tarayıcıda açın: http://localhost:${PORT}`);
});
