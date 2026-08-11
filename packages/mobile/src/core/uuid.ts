// packages/mobile/src/core/uuid.ts
//
// UUID generation. Uses `crypto.randomUUID` where present (Node 26 / Hermes 0.74+); falls back to a
// RFC4122 v4 implementation so unit tests and older runtimes both work. The idempotency key (C5.1)
// and every outbox item id derive from this.

interface CryptoLike {
  randomUUID?: () => string;
}

export function randomUUID(): string {
  const globalAny = globalThis as { crypto?: CryptoLike };
  const cryptoObj = globalAny.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  // Fallback RFC4122 v4
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b!.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}
