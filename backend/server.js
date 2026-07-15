const app = require('./src/app');
const http = require('http');
const socketConfig = require('./src/socket');
const { ensureDatabaseSchema } = require('./src/config/schema');

const PORT = process.env.PORT || 8000;

async function startServer() {
    await ensureDatabaseSchema();

    const server = http.createServer(app);
    socketConfig.init(server);

    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log('Modular Monolith structure active with WebSocket.');
    });
}

startServer().catch((error) => {
    console.error('Server startup failed:', error.message);
    process.exitCode = 1;
});

module.exports = { startServer };
