import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import type { ClientToServerEvents, ServerToClientEvents } from "@tathkara/shared";
import type { Realtime } from "../context.js";

const room = (eventId: string) => `event:${eventId}`;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Seat maps are public, so viewers join a room per event without signing in; the
 * server only ever pushes seat statuses, never who holds them.
 */
export function createRealtime() {
  let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

  const realtime: Realtime & { attach(server: HttpServer): void; close(): Promise<void> } = {
    attach(server) {
      io = new Server(server, { serveClient: false, cors: { origin: false } });
      io.on("connection", (socket) => {
        socket.on("event:join", (eventId) => {
          if (typeof eventId === "string" && UUID.test(eventId)) void socket.join(room(eventId));
        });
        socket.on("event:leave", (eventId) => {
          if (typeof eventId === "string") void socket.leave(room(eventId));
        });
      });
    },
    seatsChanged(eventId, seats) {
      if (seats.length) io?.to(room(eventId)).emit("seats:changed", { eventId, seats });
    },
    async close() {
      await io?.close();
    },
  };
  return realtime;
}
