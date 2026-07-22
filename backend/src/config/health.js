function healthHandler(_req, res) {
    return res.json({ status: 'ok' });
}

module.exports = { healthHandler };
