import { createHash, randomBytes } from "node:crypto";

/** Unambiguous alphabet for codes people may type at the door (no 0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function ticketCode() {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return `TK-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
