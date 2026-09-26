const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Simpan koneksi per BRANCH ID (bukan kode string)
// Struktur: { '1': [res1, res2], '2': [res3] }
const clientsByBranch = new Map();

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'default-secret-change-me';

/**
 * ENDPOINT 1: DITERIMA OLEH NOCOBASE (Workflow HTTP Request)
 */
app.post('/notify', (req, res) => {
    const secret = req.headers['x-webhook-secret'];
    if (secret !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const data = req.body;

    // Ambil Branch ID dari payload yang dikirim NocoBase
    // Catatan: NocoBase mungkin mengirim angka (number) atau string tergantung tipe kolom ID-nya.
    // Kita convert ke String agar konsisten sebagai Key Map.
    let branchId = null;

    if (data.branchId !== undefined && data.branchId !== null) {
        branchId = String(data.branchId);
    }

    if (!branchId) {
        console.warn('[Relay] Warning: No valid branchId provided in payload.', data);
        return res.sendStatus(200); // Drop event diam-diam jika ID cabang hilang
    }

    // Dapatkan daftar klien untuk Branch ID ini
    const branchClients = clientsByBranch.get(branchId);

    if (branchClients && branchClients.size > 0) {
        const message = `event: data-change\ndata: ${JSON.stringify(data)}\n\n`;

        for (const client of branchClients) {
            client.write(message);
        }
        console.log(`[Relay] Broadcast "${data.collection}" to ${branchClients.size} clients in Branch ID "${branchId}".`);
    } else {
        console.log(`[Relay] No listeners found for Branch ID "${branchId}". Event dropped.`);
    }

    res.sendStatus(200);
});

/**
 * ENDPOINT 2: DIDENGAR OLEH REACT AC2 (SSE)
 * Query Param: ?branchId=1
 */
app.get('/events', (req, res) => {
    // Sekarang kita pakai param 'branchId', bukan 'branch'
    const branchIdParam = req.query.branchId;

    if (!branchIdParam) {
        return res.status(400).send('Missing branchId parameter');
    }

    // Convert ke String untuk konsistensi dengan Key Map di atas
    const branchId = String(branchIdParam);

    // Header wajib SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Daftarkan klien ke Map berdasarkan Branch ID
    if (!clientsByBranch.has(branchId)) {
        clientsByBranch.set(branchId, new Set());
    }
    clientsByBranch.get(branchId).add(res);

    console.log(`[Relay] Client joined Branch ID "${branchId}". Total in branch: ${clientsByBranch.get(branchId).size}`);

    // Kirim event pembuka
    res.write('event: connected\ndata: ok\n\n');

    // Cleanup saat disconnect
    req.on('close', () => {
        const branchSet = clientsByBranch.get(branchId);
        if (branchSet) {
            branchSet.delete(res);
            if (branchSet.size === 0) {
                clientsByBranch.delete(branchId); // Bersihkan map jika kosong
            }
        }
        console.log(`[Relay] Client left Branch ID "${branchId}".`);
    });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Relay Server running on port ${PORT}`);
});