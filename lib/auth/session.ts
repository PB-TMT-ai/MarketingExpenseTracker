import { SignJWT, jwtVerify } from "jose";

/**
 * Session cookie crypto for the single shared-password gate.
 *
 * The cookie value is a `jose` HS256 JWT signed with SESSION_SECRET — NOT the password
 * itself and NOT an unsigned value, so a forged or edited cookie fails verification.
 * 30-day sliding expiry (D-13). Edge/Node compatible (used by proxy.ts and Server Actions).
 */

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

/** Read the signing secret lazily so importing this module never throws at load time. */
function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short (need >= 32 chars). Set it in .env.local.",
    );
  }
  return new TextEncoder().encode(secret);
}

/** Mint a signed session token for an authenticated shared-password session. */
export async function mintSession(): Promise<string> {
  return new SignJWT({ role: "shared" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

/** True only for a structurally valid, correctly-signed, unexpired token. */
export async function verifySession(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}
