import type { ProviderCalendar, SyncPage } from "@wiseroutine/providers";
import type { ServerEnv } from "./env";

/** Test boundaries are inert in production even if test bindings are supplied. */
export const testingEnabled = (
  env: Pick<ServerEnv, "ENVIRONMENT" | "E2E_SECRET">,
): boolean => env.ENVIRONMENT !== "production" && Boolean(env.E2E_SECRET);

export async function requestTime(
  env: ServerEnv,
  config: KVNamespace,
): Promise<number> {
  if (testingEnabled(env)) {
    const value = await config.get("e2e:clock");
    if (value !== null && Number.isFinite(Number(value))) return Number(value);
  }
  return Date.now();
}

/** Calendar fixtures must remain deterministic when a real scheduled sync
 * runs too. No provider HTTP or refresh-token grant is used for these calendars. */
export async function providerTestReader(
  env: ServerEnv,
  config: KVNamespace,
  calendarId: string,
) {
  if (!testingEnabled(env)) return undefined;
  const page = await config.get<SyncPage>(`e2e:calendar:${calendarId}`, "json");
  return page ? async () => page : undefined;
}

/** The Sync button also rediscovers calendars. Substitute that provider list
 * for seeded accounts without turning missing real credentials into success. */
export async function providerTestCalendars(
  env: ServerEnv,
  config: KVNamespace,
  connectionId: string,
): Promise<ProviderCalendar[] | undefined> {
  if (!testingEnabled(env)) return undefined;
  return (
    (await config.get<ProviderCalendar[]>(
      `e2e:calendars:${connectionId}`,
      "json",
    )) ?? undefined
  );
}

/** Only mail delivery and the failure boundary are substituted. Better Auth
 * still generates/checks/expires OTPs, rate limits, creates users and sessions,
 * and runs real local database provisioning/migrations. */
export function authTestBoundaries(env: ServerEnv, config: KVNamespace) {
  if (!testingEnabled(env)) return {};
  return {
    sendCode: async (email: string, otp: string) => {
      await config.put(
        `e2e:mail:${email.toLowerCase()}`,
        JSON.stringify({ otp }),
        { expirationTtl: 600 },
      );
    },
    beforeProvision: async () => {
      if ((await config.get("e2e:provision-failure")) === "true") {
        throw new Error("Simulated infrastructure outage before provisioning");
      }
    },
  };
}
