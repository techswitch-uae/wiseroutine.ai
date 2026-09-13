import type { CalendarProvider } from "@wiseroutine/design";
import { api } from "./api";
import { openExternal } from "./open-external";

/** Shared by Settings and the setup/reconnect prompts on Today. Consent must
 * open in the system browser, not inside the desktop webview. */
export async function beginConnect(
  provider: CalendarProvider,
): Promise<string | null> {
  try {
    const url = await api.connectUrl(provider);
    if (!(await openExternal(url))) {
      return "Couldn't open your browser. Allow pop-ups and try again.";
    }
    return null;
  } catch {
    return "Couldn't start that connection. Try again.";
  }
}
