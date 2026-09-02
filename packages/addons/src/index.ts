/**
 * What an addon may do, as data.
 *
 * Shared by the Worker and the desktop app so both decide with the same
 * functions. The client check gives a good error early. The server check is
 * the gate.
 *
 * Words: an **addon** is the package. A **widget** is a card it puts in the
 * rail. An **activity type** is a guided session it defines. "Module" is the
 * app's internal name for a running session and is not used here.
 */

/* ── Versions ───────────────────────────────────────────────────────────── */

/**
 * The SDK contract this host speaks. A manifest built against a newer one is
 * refused by `parseManifest`, so an addon never half-runs.
 */
export const API_VERSION = 1;

/* ── Identity ───────────────────────────────────────────────────────────── */

/** Lowercase, dot or hyphen separated, no slash. The slash joins keys. */
const ADDON_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ADDON_KEY = ADDON_ID;

/**
 * A key inside a settings schema. Looser than `ADDON_KEY` because it only ever
 * becomes a property in the addon's own config object. Still bounded so it
 * cannot be `__proto__` or carry a dot.
 */
const SETTING_KEY = /^[A-Za-z0-9_-]+$/;

export const isAddonId = (value: string): boolean =>
  value.length <= 64 && ADDON_ID.test(value);

/** Ids under this prefix belong to the app. The registry refuses them from
 *  anyone else. */
export const RESERVED_ID_PREFIX = "wiseroutine.";

export const isReservedId = (id: string): boolean =>
  id.startsWith(RESERVED_ID_PREFIX);

/** The full key for something an addon owns: `acme.fitness/next-workout`. */
export const qualify = (addonId: string, key: string): string =>
  `${addonId}/${key}`;

/** The addon a key belongs to, or null for one of the app's own. */
export function ownerOf(key: string): string | null {
  const slash = key.indexOf("/");
  if (slash === -1) return null;

  const addonId = key.slice(0, slash);
  const rest = key.slice(slash + 1);
  if (!isAddonId(addonId)) return null;
  if (!ADDON_KEY.test(rest) || rest.length > 64) return null;

  return addonId;
}

/* ── Capabilities ───────────────────────────────────────────────────────── */

/** How much of the schedule an addon may read. Narrowest first. */
export type ReadScope = "today" | "week" | "range" | "history";

const READ_SCOPES: readonly ReadScope[] = ["today", "week", "range", "history"];

/**
 * The scopes that may be granted right now. Only today. Widening is adding a
 * value here and a sentence to the permission screen.
 */
export const GRANTABLE_READ_SCOPES: readonly ReadScope[] = ["today"];

/**
 * How the host signs requests to a `net:fetch` origin on the addon's behalf.
 *
 * `secret` names a `secret` field in the manifest's `settings`. The host adds
 * `header: prefix + value` to every proxied request. The value never reaches
 * the addon.
 */
export interface FetchAuth {
  secret: string;
  header: string;
  prefix?: string;
}

/**
 * Everything an addon can ask for.
 *
 * There is no "write any slot". Only `write:own`, and ownership is a column
 * the server reads.
 */
export type AddonCapability =
  /** Read the user's schedule, as far out as `scope` allows. */
  | { kind: "read:schedule"; scope: ReadScope }
  /** Place slots of its own, and complete or skip them. Never the user's. */
  | { kind: "write:own" }
  /** Contribute a card to the rail. */
  | { kind: "ui:widget" }
  /** Contribute an activity type, and draw its guided session. */
  | { kind: "ui:session" }
  /**
   * Talk to these origins. They become the frame's `connect-src`, and the
   * host-side `fetch` proxy refuses anything else. No wildcards.
   */
  | { kind: "net:fetch"; origins: readonly string[]; auth?: FetchAuth }
  /** Put a page from these origins inside its own frame. The frame's
   *  `frame-src`. */
  | { kind: "ui:embed"; origins: readonly string[] }
  /** Open a link on these origins in the user's browser. https only. */
  | { kind: "open:external"; origins: readonly string[] }
  /** Keep a hidden frame running while the app is open, with no card. */
  | { kind: "background:wake" }
  /** Show the user a notification, labelled with the addon's name. */
  | { kind: "notify" }
  /** See the user's todos. */
  | { kind: "read:todos" }
  /** Add, finish, drop, and put a todo on the day. */
  | { kind: "write:todos" };

export type CapabilityKind = AddonCapability["kind"];

export type Decision = { ok: true } | { ok: false; reason: string };

const refuse = (reason: string): Decision => ({ ok: false, reason });

/**
 * Does this grant cover this request?
 *
 * `granted` is what the user approved, from `addons.granted_json`. `request`
 * is what the addon is doing now. Same type both sides, so nothing is
 * translated.
 */
export function canAddon(
  granted: readonly AddonCapability[],
  request: AddonCapability,
): Decision {
  const held = granted.filter((c) => c.kind === request.kind);
  if (held.length === 0) {
    return refuse(`This addon was not granted ${request.kind}.`);
  }

  switch (request.kind) {
    case "read:schedule": {
      const wanted = READ_SCOPES.indexOf(request.scope);
      const widest = Math.max(
        ...held.map((c) =>
          c.kind === "read:schedule" ? READ_SCOPES.indexOf(c.scope) : -1,
        ),
      );
      return wanted <= widest
        ? { ok: true }
        : refuse(`This addon may only read ${READ_SCOPES[widest]}.`);
    }

    case "net:fetch":
    case "ui:embed":
    case "open:external": {
      const allowed = new Set(
        held.flatMap((c) => ("origins" in c ? c.origins : [])),
      );
      const denied = request.origins.filter((o) => !allowed.has(o));
      return denied.length === 0
        ? { ok: true }
        : refuse(`This addon may not reach ${denied.join(", ")}.`);
    }

    case "write:own":
    case "ui:widget":
    case "ui:session":
    case "background:wake":
    case "notify":
    case "read:todos":
    case "write:todos":
      return { ok: true };
  }
}

/**
 * Is every capability in `grant` something `asked` covers?
 *
 * Used when a grant arrives from a client: the user may approve less than the
 * manifest asks for, never more.
 */
export function coveredBy(
  grant: readonly AddonCapability[],
  asked: readonly AddonCapability[],
): Decision {
  for (const capability of grant) {
    const decision = canAddon(asked, capability);
    if (!decision.ok) return refuse(`Not in the manifest: ${capability.kind}.`);
  }
  return { ok: true };
}

/** The capabilities in `asked` that `granted` does not cover yet. */
export const ungranted = (
  asked: readonly AddonCapability[],
  granted: readonly AddonCapability[],
): AddonCapability[] => asked.filter((c) => !canAddon(granted, c).ok);

/**
 * May this capability be granted at all? Policy for every addon, asked at
 * install. `canAddon` is what one user approved, asked at use.
 */
export function isGrantable(capability: AddonCapability): Decision {
  switch (capability.kind) {
    case "read:schedule":
      return GRANTABLE_READ_SCOPES.includes(capability.scope)
        ? { ok: true }
        : refuse(
            `Addons may only read ${GRANTABLE_READ_SCOPES.join(", ")} for now.`,
          );

    case "net:fetch":
    case "ui:embed":
    case "open:external": {
      const bad = capability.origins.filter((o) => !isPlainHttpsOrigin(o));
      return bad.length === 0
        ? { ok: true }
        : refuse(`Not a plain https origin: ${bad.join(", ")}.`);
    }

    default:
      return { ok: true };
  }
}

/** An `https://host` with no wildcard, no path, no query, no credentials. */
export function isPlainHttpsOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname.includes("*")) return false;
  if (url.username || url.password) return false;
  return url.origin === value;
}

/* ── Manifest ───────────────────────────────────────────────────────────── */

export interface AddonContribution {
  /** Bare here, namespaced everywhere else. See `qualify`. */
  key: string;
  name: string;
}

/* ── Settings, declared rather than drawn ───────────────────────────────── */

/** Show a field only while another field has this value. */
export interface ShowWhen {
  key: string;
  equals: string | number | boolean;
}

interface FieldBase {
  key: string;
  label: string;
  /** A short line under the field. */
  help?: string;
  showWhen?: ShowWhen;
}

/**
 * One setting, as a description. The host draws the field with its own
 * components, so it can read and write an addon's settings without running
 * the addon, and every addon's settings look like the rest of the app.
 *
 * `secret` is only allowed in the manifest's top-level `settings`. Its value
 * stays on the device, is never sent to the server, and is never given to the
 * addon. The only thing that can use it is `net:fetch` `auth`.
 */
export type SettingField =
  | (FieldBase & {
      type: "select";
      default: string;
      options: readonly string[];
    })
  | (FieldBase & {
      type: "number";
      default: number;
      min?: number;
      max?: number;
    })
  | (FieldBase & {
      type: "text";
      default: string;
      maxLength?: number;
      placeholder?: string;
    })
  | (FieldBase & { type: "boolean"; default: boolean })
  | (FieldBase & { type: "secret"; placeholder?: string });

/** An activity type an addon defines: a guided session of its own. */
export interface AddonActivityType extends AddonContribution {
  /** Finishes "When this is on, ...". */
  blurb: string;
  defaults: {
    sessionMinutes: number;
    startPolicy: "manual" | "auto" | "prompt";
  };
  /** `dim` is the near-black ground for looking away from the screen. The
   *  host paints it; the addon only says which one it drew against. */
  ground?: "page" | "dim";
  /** Room inside the session, in CSS pixels. Clamped by `CANVAS_BOUNDS`. */
  canvas?: { width: number; height: number };
  settings: readonly SettingField[];
}

/** The upper bounds keep the title and the Done button on screen. */
export const CANVAS_BOUNDS = {
  width: { min: 200, max: 560 },
  height: { min: 120, max: 520 },
} as const;

export const canvasFor = (
  type: AddonActivityType,
): { width: number; height: number } => ({
  width: clamp(type.canvas?.width ?? 360, CANVAS_BOUNDS.width),
  height: clamp(type.canvas?.height ?? 400, CANVAS_BOUNDS.height),
});

const clamp = (value: number, to: { min: number; max: number }): number =>
  Math.min(to.max, Math.max(to.min, Math.round(value)));

/** How tall a rail card may be. Tighter than a session: the rail is shared. */
export const CARD_BOUNDS = { min: 40, max: 320 } as const;

export const cardHeightFor = (height: number | undefined): number =>
  clamp(typeof height === "number" && Number.isFinite(height) ? height : 120, {
    ...CARD_BOUNDS,
  });

const START_POLICIES = ["manual", "auto", "prompt"] as const;

/** Whether a field is shown, given the current values. */
export function isShown(
  field: SettingField,
  values: Record<string, unknown>,
): boolean {
  if (!field.showWhen) return true;
  return values[field.showWhen.key] === field.showWhen.equals;
}

/** The values a schema starts with. Secrets have no value here. */
export function defaultConfig(schema: {
  settings: readonly SettingField[];
}): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of schema.settings) {
    if (field.type !== "secret") config[field.key] = field.default;
  }
  return config;
}

/**
 * Stored values, checked against the schema.
 *
 * Never throws, never returns a key the schema does not name. A bad value
 * falls back to the field's default rather than failing the whole config.
 */
export function parseConfig(
  schema: { settings: readonly SettingField[] },
  raw: unknown,
): Record<string, unknown> {
  const stored: Record<string, unknown> =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const config: Record<string, unknown> = {};
  for (const field of schema.settings) {
    const value = stored[field.key];
    switch (field.type) {
      case "select":
        config[field.key] =
          typeof value === "string" && field.options.includes(value)
            ? value
            : field.default;
        break;
      case "number": {
        const ok =
          typeof value === "number" &&
          Number.isFinite(value) &&
          (field.min === undefined || value >= field.min) &&
          (field.max === undefined || value <= field.max);
        config[field.key] = ok ? value : field.default;
        break;
      }
      case "text":
        config[field.key] =
          typeof value === "string" && value.length <= (field.maxLength ?? 500)
            ? value
            : field.default;
        break;
      case "boolean":
        config[field.key] = typeof value === "boolean" ? value : field.default;
        break;
      case "secret":
        break;
    }
  }
  return config;
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** The SDK contract it was built against. Defaults to 1. */
  apiVersion: number;
  /** What it asks for. What it was given lives in `addons.granted_json`. */
  capabilities: readonly AddonCapability[];
  /** Settings for the addon as a whole. The user edits them on the Addons
   *  page. The only place a `secret` field may appear. */
  settings: readonly SettingField[];
  widgets: readonly AddonContribution[];
  activityTypes: readonly AddonActivityType[];
  /**
   * Rows this addon adds to Quick add's "when" list. On the press the host
   * sends the addon a `quickAdd` request with the text and the key. The addon
   * decides what that means.
   */
  quickAdd: readonly AddonContribution[];
}

/**
 * Read a manifest, or decide it is not one.
 *
 * Never throws. Returns null rather than a partial object: a manifest is what
 * a permission screen is drawn from, and half of one would ask the user to
 * approve something nobody wrote.
 */
export function parseManifest(raw: unknown): AddonManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;

  const id = m.id;
  if (typeof id !== "string" || !isAddonId(id)) return null;

  const strings = ["name", "version", "description"] as const;
  for (const field of strings) {
    const value = m[field];
    if (typeof value !== "string" || value.length === 0) return null;
    if (value.length > 500) return null;
  }

  const apiVersion = m.apiVersion === undefined ? 1 : m.apiVersion;
  if (typeof apiVersion !== "number" || !Number.isInteger(apiVersion)) {
    return null;
  }
  if (apiVersion < 1 || apiVersion > API_VERSION) return null;

  const capabilities = parseCapabilities(m.capabilities);
  if (capabilities === null) return null;

  const settings = parseSettings(m.settings, { allowSecret: true });
  const widgets = parseContributions(m.widgets);
  const activityTypes = parseActivityTypes(m.activityTypes);
  const quickAdd = parseContributions(m.quickAdd);
  if (
    settings === null ||
    widgets === null ||
    activityTypes === null ||
    quickAdd === null
  ) {
    return null;
  }

  // `auth` must name a secret the manifest declares, or it can never work.
  const secrets = new Set(
    settings.filter((f) => f.type === "secret").map((f) => f.key),
  );
  for (const capability of capabilities) {
    if (capability.kind !== "net:fetch" || !capability.auth) continue;
    if (!secrets.has(capability.auth.secret)) return null;
  }

  return {
    id,
    name: m.name as string,
    version: m.version as string,
    description: m.description as string,
    apiVersion,
    capabilities,
    settings,
    widgets,
    activityTypes,
    quickAdd,
  };
}

/**
 * Read a capability list, or decide it is not one.
 *
 * Also used for `granted_json`. Origins must be plain https origins, so a
 * manifest cannot smuggle text into a CSP header. An unknown kind refuses the
 * whole list: silently dropping it would install an addon missing a
 * permission it needs, with nothing telling the user.
 */
export function parseCapabilities(raw: unknown): AddonCapability[] | null {
  if (!Array.isArray(raw)) return null;

  const out: AddonCapability[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const c = entry as Record<string, unknown>;

    switch (c.kind) {
      case "read:schedule": {
        const scope = c.scope;
        if (typeof scope !== "string") return null;
        if (!READ_SCOPES.includes(scope as ReadScope)) return null;
        out.push({ kind: "read:schedule", scope: scope as ReadScope });
        break;
      }
      case "net:fetch":
      case "ui:embed":
      case "open:external": {
        const origins = c.origins;
        if (!Array.isArray(origins)) return null;
        if (origins.length > 20) return null;
        if (!origins.every((o) => typeof o === "string")) return null;
        if (!origins.every((o) => isPlainHttpsOrigin(o as string))) return null;
        if (c.kind === "net:fetch" && c.auth !== undefined) {
          const auth = parseAuth(c.auth);
          if (auth === null) return null;
          out.push({ kind: "net:fetch", origins: origins as string[], auth });
        } else {
          out.push({ kind: c.kind, origins: origins as string[] });
        }
        break;
      }
      case "write:own":
      case "ui:widget":
      case "ui:session":
      case "background:wake":
      case "notify":
      case "read:todos":
      case "write:todos":
        out.push({ kind: c.kind });
        break;
      default:
        return null;
    }
  }
  return out;
}

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

function parseAuth(raw: unknown): FetchAuth | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.secret !== "string" || !SETTING_KEY.test(a.secret)) return null;
  if (typeof a.header !== "string" || !HEADER_NAME.test(a.header)) return null;
  // The one header the host owns. An addon that could sign as the user's
  // cookie jar would be a different capability.
  if (a.header.toLowerCase() === "cookie") return null;
  if (a.prefix !== undefined) {
    if (typeof a.prefix !== "string" || a.prefix.length > 32) return null;
    if (/[\r\n]/.test(a.prefix)) return null;
  }
  return {
    secret: a.secret,
    header: a.header,
    ...(typeof a.prefix === "string" ? { prefix: a.prefix } : {}),
  };
}

function parseContributions(raw: unknown): AddonContribution[] | null {
  // Absent is empty. An addon that only contributes widgets need not write
  // `"activityTypes": []`.
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;

  const out: AddonContribution[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const c = entry as Record<string, unknown>;
    if (typeof c.key !== "string" || !ADDON_KEY.test(c.key)) return null;
    if (c.key.length > 64) return null;
    if (typeof c.name !== "string" || c.name.length === 0) return null;
    if (c.name.length > 200) return null;
    out.push({ key: c.key, name: c.name });
  }
  return out;
}

function parseActivityTypes(raw: unknown): AddonActivityType[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;

  const out: AddonActivityType[] = [];
  for (const entry of raw) {
    const base = parseContributions([entry]);
    if (base === null || base[0] === undefined) return null;
    const c = entry as Record<string, unknown>;

    if (typeof c.blurb !== "string" || c.blurb.length === 0) return null;
    if (c.blurb.length > 300) return null;

    const defaults = c.defaults;
    if (typeof defaults !== "object" || defaults === null) return null;
    const d = defaults as Record<string, unknown>;

    // A session is a block on someone's day, not an afternoon.
    const minutes = d.sessionMinutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes)) return null;
    if (minutes < 1 || minutes > 240) return null;

    const policy = d.startPolicy;
    if (typeof policy !== "string") return null;
    if (!START_POLICIES.includes(policy as (typeof START_POLICIES)[number])) {
      return null;
    }

    const settings = parseSettings(c.settings, { allowSecret: false });
    if (settings === null) return null;

    const ground = c.ground;
    if (ground !== undefined && ground !== "page" && ground !== "dim") {
      return null;
    }

    // Malformed is refused here. Out of range is clamped by `canvasFor`.
    const canvas = c.canvas;
    if (canvas !== undefined) {
      if (typeof canvas !== "object" || canvas === null) return null;
      const { width, height } = canvas as Record<string, unknown>;
      if (typeof width !== "number" || !Number.isFinite(width)) return null;
      if (typeof height !== "number" || !Number.isFinite(height)) return null;
    }

    out.push({
      key: base[0].key,
      name: base[0].name,
      blurb: c.blurb,
      defaults: {
        sessionMinutes: minutes,
        startPolicy: policy as (typeof START_POLICIES)[number],
      },
      ...(ground !== undefined ? { ground } : {}),
      ...(canvas !== undefined
        ? { canvas: canvas as { width: number; height: number } }
        : {}),
      settings,
    });
  }
  return out;
}

/** Strict, because the host draws whatever this says. */
function parseSettings(
  raw: unknown,
  { allowSecret }: { allowSecret: boolean },
): SettingField[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > 20) return null;

  const out: SettingField[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const f = entry as Record<string, unknown>;

    if (typeof f.key !== "string" || !SETTING_KEY.test(f.key)) return null;
    if (f.key.length > 64 || seen.has(f.key)) return null;
    seen.add(f.key);

    if (typeof f.label !== "string" || f.label.length === 0) return null;
    if (f.label.length > 100) return null;

    const base: FieldBase = { key: f.key, label: f.label };
    if (f.help !== undefined) {
      if (typeof f.help !== "string" || f.help.length > 200) return null;
      base.help = f.help;
    }
    if (f.showWhen !== undefined) {
      const s = f.showWhen as Record<string, unknown> | null;
      if (typeof s !== "object" || s === null) return null;
      if (typeof s.key !== "string" || !SETTING_KEY.test(s.key)) return null;
      const equals = s.equals;
      if (
        typeof equals !== "string" &&
        typeof equals !== "number" &&
        typeof equals !== "boolean"
      ) {
        return null;
      }
      base.showWhen = { key: s.key, equals };
    }

    switch (f.type) {
      case "select": {
        const options = f.options;
        if (!Array.isArray(options) || options.length === 0) return null;
        if (options.length > 50) return null;
        if (!options.every((o) => typeof o === "string" && o.length <= 100)) {
          return null;
        }
        if (typeof f.default !== "string") return null;
        if (!options.includes(f.default)) return null;
        out.push({
          ...base,
          type: "select",
          default: f.default,
          options: options as string[],
        });
        break;
      }
      case "number": {
        if (typeof f.default !== "number" || !Number.isFinite(f.default)) {
          return null;
        }
        const { min, max } = f;
        if (min !== undefined && typeof min !== "number") return null;
        if (max !== undefined && typeof max !== "number") return null;
        if (typeof min === "number" && f.default < min) return null;
        if (typeof max === "number" && f.default > max) return null;
        out.push({
          ...base,
          type: "number",
          default: f.default,
          ...(typeof min === "number" ? { min } : {}),
          ...(typeof max === "number" ? { max } : {}),
        });
        break;
      }
      case "text": {
        if (typeof f.default !== "string") return null;
        const maxLength = f.maxLength;
        if (maxLength !== undefined && typeof maxLength !== "number") {
          return null;
        }
        if (f.default.length > (maxLength ?? 500)) return null;
        const placeholder = parsePlaceholder(f.placeholder);
        if (placeholder === null) return null;
        out.push({
          ...base,
          type: "text",
          default: f.default,
          ...(typeof maxLength === "number" ? { maxLength } : {}),
          ...(placeholder !== undefined ? { placeholder } : {}),
        });
        break;
      }
      case "boolean": {
        if (typeof f.default !== "boolean") return null;
        out.push({ ...base, type: "boolean", default: f.default });
        break;
      }
      case "secret": {
        if (!allowSecret) return null;
        const placeholder = parsePlaceholder(f.placeholder);
        if (placeholder === null) return null;
        out.push({
          ...base,
          type: "secret",
          ...(placeholder !== undefined ? { placeholder } : {}),
        });
        break;
      }
      default:
        return null;
    }
  }
  return out;
}

/** Undefined when absent, null when wrong. */
function parsePlaceholder(raw: unknown): string | undefined | null {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length > 100) return null;
  return raw;
}
