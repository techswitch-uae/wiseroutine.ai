import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import { createAuth } from "./auth";
import { resolveServerEnv } from "./env";
import { directory, resetDatabases, seedUser } from "./test-support";

beforeEach(resetDatabases);
test("the code's attempt budget survives the HTTP rate-limit window", async () => {
  const user = await seedUser();
  const settings = await resolveServerEnv(
    env as unknown as Record<string, unknown>,
  );
  let otp = "";
  const auth = createAuth(directory(), settings, undefined, {
    sendCode: async (_email, code) => {
      otp = code;
    },
  });
  const email = `${user.userId}@example.com`;
  await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  const wrong = otp === "000000" ? "111111" : "000000";
  // Server-side API calls exercise the code budget independently of HTTP's
  // 3/minute limiter. Browser acceptance separately proves that outer gate.
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: wrong } }),
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
  }
  await expect(
    auth.api.signInEmailOTP({ body: { email, otp } }),
  ).rejects.toMatchObject({ body: { code: "TOO_MANY_ATTEMPTS" } });
});
