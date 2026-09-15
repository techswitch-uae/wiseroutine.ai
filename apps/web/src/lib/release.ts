import config from "../content/release.json" with { type: "json" };

export type Download = {
  platform: string;
  requirements: string;
  url: string;
};

export type Release = {
  /** Installer readiness only. Account signup is always offered. */
  status: "preview" | "live";
  signupUrl: string;
  downloads: Download[];
};

/** Public, reviewed release facts, not inferred from the visitor's OS.
 * Publishing a download is a release decision, not a marketing fallback. */
export function validateRelease(value: unknown): Release {
  if (!value || typeof value !== "object") throw new Error("Missing release");
  const { status, signupUrl, downloads } = value as Release;
  if (typeof signupUrl !== "string")
    throw new Error("Missing account signup URL");
  const account = new URL(signupUrl);
  if (
    account.protocol !== "https:" ||
    account.username ||
    account.password ||
    account.hostname === "localhost" ||
    account.hostname.endsWith(".example") ||
    account.pathname !== "/signin" ||
    account.search ||
    account.hash
  ) {
    throw new Error(
      "Signup must point to the existing app's HTTPS /signin route",
    );
  }
  if (status !== "preview" && status !== "live") {
    throw new Error("Release status must be preview or live");
  }
  if (!Array.isArray(downloads)) throw new Error("Missing downloads array");
  if (status === "preview" && downloads.length > 0) {
    throw new Error("Preview must not offer unvalidated installers");
  }
  if (status === "live" && downloads.length === 0) {
    throw new Error("A live release needs a validated download");
  }
  const platforms = new Set<string>();
  for (const download of downloads) {
    if (
      !download ||
      typeof download.platform !== "string" ||
      !download.platform.trim() ||
      typeof download.requirements !== "string" ||
      !download.requirements.trim() ||
      typeof download.url !== "string"
    ) {
      throw new Error("Downloads need a platform, requirements and HTTPS URL");
    }
    const url = new URL(download.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".example")
    ) {
      throw new Error(
        "Downloads must use public HTTPS URLs without credentials",
      );
    }
    if (platforms.has(download.platform)) throw new Error("Duplicate platform");
    platforms.add(download.platform);
  }
  return { status, signupUrl, downloads };
}

export const release = validateRelease(config);
