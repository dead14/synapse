import { io, Socket } from 'socket.io-client';
import { API_BASE } from './api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_BASE;

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    const options = {
      transports: ['websocket'],
      autoConnect: true,
      withCredentials: true,
    };
    socket = SOCKET_URL ? io(SOCKET_URL, options) : io(options);
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
