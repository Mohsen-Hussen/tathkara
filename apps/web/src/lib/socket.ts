import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@tathkara/shared";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

/** One shared connection for the whole app; rooms are joined per event page. */
export function getSocket() {
  socket ??= io({ path: "/socket.io", transports: ["websocket", "polling"] });
  return socket;
}
