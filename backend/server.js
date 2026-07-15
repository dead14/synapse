const app = require('./src/app');
const http = require('http');
const socketConfig = require('./src/socket');

const PORT = process.env.PORT || 8000;

// Create HTTP Server wrapping the Express app
const server = http.createServer(app);

// Initialize Socket.io
const io = socketConfig.init(server);

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    
    // Client must emit 'join_room' with their userId to receive targeted events
    socket.on('join_room', (userId) => {
        if (userId) {
            socket.join(`user_${userId}`);
            console.log(`Socket ${socket.id} joined room: user_${userId}`);
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Modular Monolith structure active with WebSocket.`);
});
