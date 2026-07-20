const express = require('express');
const cors = require('cors');
const path = require('path');
const { getJwtSecret } = require('./config/auth');
const { createCorsOptions, securityHeaders } = require('./config/security');
const { authMiddleware } = require('./middlewares/authMiddleware');
const metrics = require('./observability/metrics');
const app = express();

// Validate security-critical production configuration during startup.
getJwtSecret();
const corsOptions = createCorsOptions();

if (/^\d+$/.test(process.env.TRUST_PROXY || '')) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY));
}

app.use((req, res, next) => {
    const startedAt = Date.now();
    if (process.env.NODE_ENV !== 'test') {
        console.log(`[REQ] ${req.method} ${req.path}`);
        res.on('finish', () => {
            console.log(`[RES] ${req.method} ${req.path} -> ${res.statusCode}`);
        });
    }
    res.on('finish', () => {
        if (req.path.startsWith('/api/')) {
            metrics.observe('http_request', Date.now() - startedAt, {
                method: req.method,
                route: req.path
                    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,36}(?=\/|$)/gi, '/:id')
                    .replace(/\/\d+(?=\/|$)/g, '/:id')
                    .slice(0, 100),
                status: res.statusCode,
            });
        }
    });
    next();
});

app.use(securityHeaders);
app.use(cors(corsOptions));

const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '10mb';
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ limit: requestBodyLimit, extended: true }));

app.get('/api/metrics', authMiddleware, (_req, res) => {
    res.type('text/plain').send(metrics.prometheus());
});
app.post('/api/metrics/browser', authMiddleware, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const durationMs = Number(req.body?.durationMs);
    if (!/^render_[a-z0-9_]{1,40}$/i.test(name) || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 120_000) {
        return res.status(400).json({ error: 'Invalid browser metric' });
    }
    metrics.observe(name, durationMs, { surface: 'browser' });
    return res.status(204).send();
});

// Routes
const authRoutes = require('./modules/auth/authRoutes');
const userRoutes = require('./modules/users/userRoutes');
const organizationRoutes = require('./modules/organizations/organizationRoutes');
const dashboardRoutes = require('./modules/dashboard/dashboardRoutes');
const ffsRoutes = require('./modules/ffs/ffsRoutes');
const alignmentRoutes = require('./modules/alignment/alignmentRoutes');
const inspectionRoutes = require('./modules/inspections/inspectionRoutes');
const integrityRoutes = require('./modules/integrity/integrityRoutes');
const complianceRoutes = require('./modules/compliance/complianceRoutes');
const directAssessmentRoutes = require('./modules/directAssessment/directAssessmentRoutes');
const fieldMeasurementRoutes = require('./modules/fieldMeasurements/fieldMeasurementRoutes');
const ingestionRoutes = require('./modules/ingestion/ingestionRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/inspection-runs', inspectionRoutes);
app.use('/api/ingestion-jobs', ingestionRoutes);
app.use('/api/integrity-cases', integrityRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/direct-assessments', directAssessmentRoutes);
app.use('/api/field-measurements', fieldMeasurementRoutes);
app.use('/api', ffsRoutes); // for /api/download-template
app.use('/api', alignmentRoutes); // for /api/upload-csv and /api/run

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

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

    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body is too large' });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Uploaded file is too large' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(415).json({ error: 'Uploaded file type is not supported' });
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Malformed JSON request' });
    }

    const response = { error: 'Something went wrong' };
    if (process.env.NODE_ENV !== 'production' && err.message) {
        response.details = err.message;
    }
    return res.status(500).json(response);
});

module.exports = app;
