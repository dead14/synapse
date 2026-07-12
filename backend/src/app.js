const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
const authRoutes = require('./modules/auth/authRoutes');
const userRoutes = require('./modules/users/userRoutes');
const dashboardRoutes = require('./modules/dashboard/dashboardRoutes');
const ffsRoutes = require('./modules/ffs/ffsRoutes');
const alignmentRoutes = require('./modules/alignment/alignmentRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api', ffsRoutes); // for /api/download-template
app.use('/api', alignmentRoutes); // for /api/upload-csv and /api/run

// Initialize background worker
require('./modules/alignment/alignmentWorker');

// Serve static frontend in production
const frontendDistPath = path.join(__dirname, '../../frontend/dist');

// SSE Endpoint for Alignment Execution Progress
app.get('/stream-alignment', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendMsg = (msg) => res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);
    
    setTimeout(() => sendMsg('FASE 1: Memulai Inisiasi Data Pipeline...'), 1000);
    setTimeout(() => sendMsg('FASE 2: Menjalankan GW Matching DTW dengan Threshold...'), 3000);
    setTimeout(() => sendMsg('FASE 3: Algoritma Hungarian untuk Mencocokkan Anomali...'), 6000);
    setTimeout(() => sendMsg('FASE 4: Rekonsiliasi Hasil & Kalkulasi Akurasi...'), 9000);
    setTimeout(() => {
        sendMsg('SELESAI: Penyelarasan Pipa Selesai!');
        res.write(`data: ${JSON.stringify({ status: 'done' })}\n\n`);
        res.end();
    }, 12000);
});

app.use(express.static(frontendDistPath));

app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(path.join(frontendDistPath, 'index.html'));
    } else {
        next();
    }
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

module.exports = app;
