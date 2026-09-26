const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Map untuk simpan koneksi per cabang: { 'BPP': [res1, res2], 'SMD': [res3] }
const clientsByBranch = new Map();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'default-secret-change-me';

/**
 * ENDPOINT 1: NocoBase POST ke sini (/notify)
 */
app.post('/notify', (req, res) => {
    const secret = req.headers['x-webhook-secret'];
    if (secret !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const data = req.body;
    const branchCode = data.branchCode; // Kunci isolasi!

    if (!branchCode) {
        console.warn('[Relay] Warning: No branchCode provided.');
        return res.sendStatus(200);
    }

    const branchClients = clientsByBranch.get(branchCode);

    if (branchClients && branchClients.size > 0) {
        const message = `event: data-change\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of branchClients) {
            client.write(message);
        }
        console.log(`[Relay] Broadcast "${data.collection}" to ${branchClients.size} clients in branch "${branchCode}".`);
    } else {
        console.log(`[Relay] No listeners found for branch "${branchCode}". Event dropped.`);
    }

    res.sendStatus(200);
});

/**
 * ENDPOINT 2: React AC2 GET/Listen ke sini (/events?branch=BPP)
 */
app.get('/events', (req, res) => {
    const branchCode = req.query.branch;

    if (!branchCode) {
        return res.status(400).send('Missing branch parameter');
    }

    // Header wajib SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Daftarkan klien ke Map berdasarkan Cabang
    if (!clientsByBranch.has(branchCode)) {
        clientsByBranch.set(branchCode, new Set());
    }
    clientsByBranch.get(branchCode).add(res);

    console.log(`[Relay] Client joined branch "${branchCode}". Total in branch: ${clientsByBranch.get(branchCode).size}`);

    // Kirim event pembuka
    res.write('event: connected\ndata: ok\n\n');

    // Cleanup saat disconnect
    req.on('close', () => {
        const branchSet = clientsByBranch.get(branchCode);
        if (branchSet) {
            branchSet.delete(res);
            if (branchSet.size === 0) {
                clientsByBranch.delete(branchCode);
            }
        }
        console.log(`[Relay] Client left branch "${branchCode}".`);
    });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Relay Server running on port ${PORT}`);
});