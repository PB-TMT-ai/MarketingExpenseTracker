/**
 * Fail fast — and loud — at server boot if the required server-only auth secrets are missing
 * or weak. Without this, a misconfigured deploy degrades silently: verifySession() swallows
 * the error and redirects every request to /login (an unbreakable loop), while a correct
 * password would otherwise 500 inside the login action. Called from instrumentation.ts.
 */
export function assertAuthEnv(): void {
  const problems: string[] = [];
  if (!process.env.APP_PASSWORD) {
    problems.push("APP_PASSWORD is not set");
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    problems.push("SESSION_SECRET is not set");
  } else if (secret.length < 32) {
    problems.push("SESSION_SECRET must be at least 32 characters");
  }
  if (problems.length > 0) {
    throw new Error(
      `Auth misconfigured — fix .env.local (local) or the deploy environment:\n  - ${problems.join(
        "\n  - ",
      )}`,
    );
  }
}
