let io;

const { createCorsOptions } = require('./config/security');
const { extractAuthToken, verifyAuthToken } = require('./middlewares/authMiddleware');

function authenticationError() {
  const error = new Error('Authentication required');
  error.data = { code: 'UNAUTHORIZED' };
  return error;
}

function authenticateSocket(socket, next) {
  const handshake = socket.handshake || {};
  const token = extractAuthToken({
    auth: handshake.auth,
    headers: handshake.headers,
  });

  if (!token) return next(authenticationError());

  try {
    socket.user = verifyAuthToken(token);
    return next();
  } catch {
    return next(authenticationError());
  }
}

function getSocketRooms(user) {
  const rooms = [`user_${user.id}`];
  if (user.orgId !== undefined && user.orgId !== null) {
    rooms.push(`org_${user.orgId}`);
  }
  return rooms;
}

module.exports = {
  init: (server) => {
    const { Server } = require('socket.io');
    io = new Server(server, {
      cors: createCorsOptions(),
    });

    io.use(authenticateSocket);
    io.on('connection', (socket) => {
      const rooms = getSocketRooms(socket.user);
      rooms.forEach((room) => socket.join(room));
      console.log(`Authenticated socket connected: ${socket.id}`);

      socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
      });
    });

    return io;
  },
  getIO: () => {
    if (!io) {
      console.warn("Socket.io is not initialized yet!");
      return null;
    }
    return io;
  },
  authenticateSocket,
  getSocketRooms,
};
