let io;

const { createCorsOptions } = require('./config/security');
const { extractAuthToken, verifyAuthToken } = require('./middlewares/authMiddleware');
const {
  defaultPrincipalCache,
  tokenVersionFromClaims,
} = require('./middlewares/principalCache');

function authenticationError() {
  const error = new Error('Authentication required');
  error.data = { code: 'UNAUTHORIZED' };
  return error;
}

// Handshakes get the same revocation check as HTTP requests: a deactivated
// user or a bumped token_version cannot open a socket, and the database role
// overrides the token claim (same staleness bound as principalCache.js).
function createSocketAuthenticator({ principalCache = defaultPrincipalCache } = {}) {
  return async function authenticateSocket(socket, next) {
    const handshake = socket.handshake || {};
    const token = extractAuthToken({
      auth: handshake.auth,
      headers: handshake.headers,
    });

    if (!token) return next(authenticationError());

    let decoded;
    try {
      decoded = verifyAuthToken(token);
    } catch {
      return next(authenticationError());
    }

    try {
      const principal = await principalCache.load(Number(decoded.id));
      if (!principal.exists || !principal.isActive
          || principal.tokenVersion !== tokenVersionFromClaims(decoded)) {
        return next(authenticationError());
      }
      socket.user = { ...decoded, role: principal.role || decoded.role };
      return next();
    } catch {
      // Fail closed: socket clients reconnect on their own, so a database
      // blip is a delayed connection rather than a stuck session.
      return next(authenticationError());
    }
  };
}

const authenticateSocket = createSocketAuthenticator();

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
  createSocketAuthenticator,
  getSocketRooms,
};
