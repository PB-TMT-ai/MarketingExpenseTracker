import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time shared-password check.
 *
 * We compare SHA-256 digests (always 32 bytes) instead of the raw strings: `timingSafeEqual`
 * throws on unequal-length buffers, and comparing digests means the check leaks neither the
 * password's value nor its length through timing. Never use `===` on the secret — string
 * equality short-circuits on the first differing byte and is timing-observable.
 */
export function verifyPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const inputDigest = createHash("sha256").update(input, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(inputDigest, expectedDigest);
}
