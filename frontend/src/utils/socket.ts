import { io, Socket } from 'socket.io-client';

// Define the URL of your backend server
const SOCKET_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
    });

    socket.on('connect', () => {
      console.log('Socket.io connected:', socket?.id);
      // Auto-join user's private room so we receive targeted events
      const user = localStorage.getItem('synapse_user');
      if (user) {
        try {
          const parsed = JSON.parse(user);
          if (parsed?.id) {
            socket?.emit('join_room', parsed.id);
          }
        } catch {}
      }
    });

    socket.on('disconnect', () => {
      console.log('Socket.io disconnected');
    });
  }
  return socket;
};

export const joinRoom = (userId: string | number) => {
  const s = getSocket();
  s.emit('join_room', userId);
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
