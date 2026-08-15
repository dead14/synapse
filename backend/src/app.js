const express = require('express');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const { getJwtSecret } = require('./config/auth');
const { healthHandler, createReadinessHandler } = require('./config/health');
const { createCorsOptions, resolveTrustProxy, securityHeaders } = require('./config/security');
const { authMiddleware } = require('./middlewares/authMiddleware');
const {
    authenticatedUserKey,
    createRedisRateLimiter,
    integerFromEnv,
} = require('./middlewares/redisRateLimit');
const metrics = require('./observability/metrics');
const { PUBLIC_SHARE_BODY_LIMIT } = require('./modules/publicShares/publicShareContract');
const app = express();

// Label metrics by the matched route template, never by the raw URL.  This
// middleware runs before auth, so with req.path as the label any client could
// mint an unbounded number of permanent metric series with a 404 loop.
// Unmatched requests all collapse into a single bucket.
function metricRoute(req) {
    const template = req.route?.path;
    if (template) {
        const base = req.baseUrl || '';
        return `${base}${template === '/' ? '' : template}`.slice(0, 100) || '/';
    }
    return 'unmatched';
}

// Validate security-critical production configuration during startup.
getJwtSecret();
const corsOptions = createCorsOptions();

const trustProxy = resolveTrustProxy(process.env.TRUST_PROXY);
if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
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
                route: metricRoute(req),
                status: res.statusCode,
            });
        }
    });
    next();
});

// Nothing sits in front of this process — no reverse proxy, no CDN — so if the
// responses are not compressed here they are not compressed at all.  That is
// what made the alignment result and the published FFS link slow: a result page
// is 20k rows of repetitive tabular JSON and a shared assessment can reach tens
// of megabytes, both of which are exactly the shape gzip does best on.
//
// Registered before the routes and before express.static so it covers the API
// responses and the frontend bundle alike.  Socket.IO is attached to the HTTP
// server rather than to this middleware chain and is unaffected.
app.use(compression({
    // Below roughly one MTU the compression costs more than it saves.
    threshold: 1024,
    // A caller that cannot buffer a whole compressed response — a download the
    // browser streams to disk, an EventSource — opts out per request rather
    // than forcing the ceiling down for everyone.
    filter: (req, res) => (
        req.headers['x-no-compression'] ? false : compression.filter(req, res)
    ),
}));
app.use(securityHeaders);
app.use(cors(corsOptions));

const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '10mb';
// Publishing an FFS link uploads the whole frozen assessment in one request,
// which is legitimately far larger than anything else the API accepts. It gets
// its own ceiling, taken from the share contract so the two cannot drift, and
// the general body guard stays where it is for every other route.
const shareBodyLimit = process.env.PUBLIC_SHARE_BODY_LIMIT || PUBLIC_SHARE_BODY_LIMIT;
const generalJsonParser = express.json({ limit: requestBodyLimit });
const shareJsonParser = express.json({ limit: shareBodyLimit });
// Saving an FFS session uploads the same frozen assessment a published link
// does, so it needs the same ceiling for the same reason.
const isLargeCaseUpload = (req) => req.method === 'POST'
    && (req.path === '/api/public-shares' || req.path === '/api/ffs/sessions');
app.use((req, res, next) => (
    isLargeCaseUpload(req) ? shareJsonParser : generalJsonParser
)(req, res, next));
app.use(express.urlencoded({ limit: requestBodyLimit, extended: true }));

app.get('/api/health', healthHandler);
// Readiness variant: 200 when core dependencies answer, 503 with per-check
// detail when degraded.  The plain /api/health payload above stays fixed for
// the deploy gate.
app.get('/api/health/ready', createReadinessHandler());

// Global per-user API budget, registered after the health endpoints (which
// stay unlimited for the deploy gate) and before every authenticated route.
// It is keyed by the verified JWT identity: anonymous or invalid-token
// requests are skipped here — they either hit the dedicated auth limiter or
// fail authentication downstream.  Redis outages fail open (see
// middlewares/redisRateLimit.js).
app.use('/api', createRedisRateLimiter({
    prefix: 'rl:api',
    windowMs: integerFromEnv('RATE_LIMIT_GLOBAL_WINDOW_MS', 60_000),
    max: integerFromEnv('RATE_LIMIT_GLOBAL_MAX', 600),
    keyGenerator: authenticatedUserKey,
}));

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
const masterAdminRoutes = require('./modules/masterAdmin/masterAdminRoutes');
const publicShareRoutes = require('./modules/publicShares/publicShareRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/master-admin', masterAdminRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/inspection-runs', inspectionRoutes);
app.use('/api/ingestion-jobs', ingestionRoutes);
app.use('/api/integrity-cases', integrityRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/direct-assessments', directAssessmentRoutes);
app.use('/api/field-measurements', fieldMeasurementRoutes);
app.use('/api/public-shares', publicShareRoutes);
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
