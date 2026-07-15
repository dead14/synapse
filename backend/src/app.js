const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.path}`);
    res.on('finish', () => {
        console.log(`[RES] ${req.method} ${req.path} -> ${res.statusCode}`);
    });
    next();
});

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

// SSE /stream-alignment removed — real-time updates now via Socket.io

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
