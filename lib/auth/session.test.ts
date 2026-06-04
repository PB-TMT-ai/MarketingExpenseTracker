import { describe, it, expect, beforeAll } from "vitest";
import { mintSession, verifySession } from "./session";

const SECRET_A = "test-secret-A-at-least-32-characters-long";
const SECRET_B = "test-secret-B-a-completely-different-key!";

beforeAll(() => {
  process.env.SESSION_SECRET = SECRET_A;
});

describe("session", () => {
  it("round-trips a minted token (mint -> verify === true)", async () => {
    const token = await mintSession();
    expect(await verifySession(token)).toBe(true);
  });

  it("rejects garbage", async () => {
    expect(await verifySession("garbage")).toBe(false);
    expect(await verifySession("")).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    process.env.SESSION_SECRET = SECRET_A;
    const token = await mintSession();
    // Same token, different verifying key -> must fail.
    process.env.SESSION_SECRET = SECRET_B;
    expect(await verifySession(token)).toBe(false);
    process.env.SESSION_SECRET = SECRET_A; // restore for any later tests
  });
});
