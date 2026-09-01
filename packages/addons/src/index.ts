/**
 * What an addon may do, as data.
 *
 * The same shape as `@wiseroutine/plans` and for the same reason: one source
 * of truth both sides import, the Worker enforcing and the client calling the
 * identical function to decide what to show. The client call is a convenience.
 * The server call is the truth - a gate that only exists in the UI is not a
 * gate, and an addon is written by a stranger.
 *
 * Nothing here executes anything, loads anything or talks to a database. It is
 * vocabulary and rules, so that both the Worker and the desktop app can reason
 * about an addon without either one owning the definition.
 *
 * ## The words
 *
 * An **addon** is the package somebody outside this repo wrote. A **widget**
 * is one card it may put in the rail. An addon may also define **activity
 * types**, which are guided sessions of its own. "Module" is not used for any
 * of it: that word already means the guided session an activity runs
 * (`preset_key` on `activities`), and reusing it made every sentence about
 * either one ambiguous.
 */

/* ── Identity ────────────────────────────────────────────────────────────── */

/**
 * An addon id: lowercase, dot-separated, no slash.
 *
 * The slash is reserved because it is the separator in every key the addon
 * owns - `acme.fitness/next-workout`. An id containing one would make
 * `ownerOf` ambiguous, so it is refused at the boundary rather than escaped.
 */
const ADDON_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** A key inside an addon: same rules, and the half after the slash. */
const ADDON_KEY = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export const isAddonId = (value: string): boolean =>
  value.length <= 64 && ADDON_ID.test(value);

/**
 * The fully qualified key for something an addon owns.
 *
 * Widgets and activity types share one namespace on purpose: they are both
 * "things this addon contributes", they are both stored as bare strings in
 * columns that predate addons (`widgets.widget_key`, `activities.preset_key`),
 * and a single rule for reading an owner out of a key is one rule to get right.
 */
export const qualify = (addonId: string, key: string): string =>
  `${addonId}/${key}`;

/**
 * The addon a key belongs to, or null for one of the app's own.
 *
 * `up_next` is the app's. `acme.fitness/next-workout` is not. Anything with a
 * malformed half is treated as the app's - which means it will not be found in
 * the first-party registry either, and draws nothing. An unrecognised key
 * leaving a gap rather than throwing is already how the rail and the guided
 * sessions behave, and this keeps that true for a key that merely looks like
 * an addon's.
 */
export function ownerOf(key: string): string | null {
  const slash = key.indexOf("/");
  if (slash === -1) return null;

  const addonId = key.slice(0, slash);
  const rest = key.slice(slash + 1);
  if (!isAddonId(addonId)) return null;
  if (!ADDON_KEY.test(rest) || rest.length > 64) return null;

  return addonId;
}

/* ── Capabilities ────────────────────────────────────────────────────────── */

/**
 * How much of the schedule an addon may read.
 *
 * Ordered narrowest first, and deliberately a scale rather than a set of
 * unrelated permissions: "may it see next week" is the same question as "may
 * it see today", asked about a wider window, and modelling it as one
 * capability with a scope is what stops the answer being enforced in two
 * places that can disagree.
 */
export type ReadScope = "today" | "week" | "range" | "history";

/** Widest first, so an index comparison answers "does this cover that". */
const READ_SCOPES: readonly ReadScope[] = ["today", "week", "range", "history"];

/**
 * The scopes that may actually be granted right now.
 *
 * Today, and only today. The other three are named because the model has to
 * be able to express them the day one is opened up - widening then is adding a
 * value to this list and a sentence to the install screen, not inventing a new
 * capability and a new enforcement path for it.
 *
 * There is a test asserting that the wider scopes are refused. Opening one is
 * meant to be a deliberate act with a failing test to flip, not something that
 * happens because nobody noticed the gate was open.
 */
export const GRANTABLE_READ_SCOPES: readonly ReadScope[] = ["today"];

/**
 * Everything an addon can ask for.
 *
 * Note what has no capability at all: writing a slot the addon did not create.
 * It is not refused by a check, it is absent from the vocabulary - there is no
 * "write any slot" to grant, only `write:own`, and ownership is a column the
 * server reads. A permission that cannot be requested cannot be granted by
 * mistake.
 */
export type AddonCapability =
  /** Read the user's schedule, as far out as `scope` allows. */
  | { kind: "read:schedule"; scope: ReadScope }
  /**
   * Create slots and activities, and change the ones it created.
   *
   * Ownership-bounded by construction rather than by scope: the check is
   * `owner_addon_id = this addon`, run by the server on every write.
   */
  | { kind: "write:own" }
  /** Contribute a card to the rail. */
  | { kind: "ui:widget" }
  /** Contribute an activity type, and draw its guided session. */
  | { kind: "ui:session" }
  /**
   * Talk to hosts outside this app.
   *
   * The origins are the addon's whole allowance and become the `connect-src`
   * of the frame it runs in, so this is enforced by the browser as well as by
   * a check. Wildcards are refused: an integration knows its own API's host.
   */
  | { kind: "net:fetch"; origins: readonly string[] }
  /** Be woken when it is not on screen. */
  | { kind: "background:wake" }
  /** Put a notification in front of the user. */
  | { kind: "notify" };

export type CapabilityKind = AddonCapability["kind"];

export type Decision = { ok: true } | { ok: false; reason: string };

const refuse = (reason: string): Decision => ({ ok: false, reason });

/**
 * Does this grant cover this request?
 *
 * `granted` is what the user approved at install, read from `addons.granted_json`.
 * `request` is what the addon is trying to do right now. Both are the same
 * type, which is the point: an addon asks in the vocabulary it is granted in,
 * so there is no translation step to get wrong.
 *
 * Unlike `can()` in `@wiseroutine/plans` there is no upsell. A refusal here is
 * not an invitation to buy something, it is the boundary working.
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
      // The widest scope granted, compared by position. A grant of `week`
      // covers a request for `today`; the reverse is what this stops.
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

    case "net:fetch": {
      const allowed = new Set(
        held.flatMap((c) => (c.kind === "net:fetch" ? c.origins : [])),
      );
      const denied = request.origins.filter((o) => !allowed.has(o));
      return denied.length === 0
        ? { ok: true }
        : refuse(`This addon may not reach ${denied.join(", ")}.`);
    }

    // Held at all is the whole question: these carry nothing to compare.
    case "write:own":
    case "ui:widget":
    case "ui:session":
    case "background:wake":
    case "notify":
      return { ok: true };
  }
}

/**
 * May this capability be granted at all, whatever the addon asked for?
 *
 * Separate from `canAddon`, and asked at install rather than at use. The two
 * answer different questions: this one is policy that applies to every addon
 * on the registry, `canAddon` is what one particular user approved.
 */
export function isGrantable(capability: AddonCapability): Decision {
  switch (capability.kind) {
    case "read:schedule":
      return GRANTABLE_READ_SCOPES.includes(capability.scope)
        ? { ok: true }
        : refuse(
            `Addons may only read ${GRANTABLE_READ_SCOPES.join(", ")} for now.`,
          );

    case "net:fetch": {
      // A wildcard host is a request for the whole web wearing a specific
      // coat, and it would also make the frame's `connect-src` meaningless.
      const bad = capability.origins.filter((o) => !isPlainHttpsOrigin(o));
      return bad.length === 0
        ? { ok: true }
        : refuse(`Not a plain https origin: ${bad.join(", ")}.`);
    }

    default:
      return { ok: true };
  }
}

/**
 * An `https://host` with no wildcard, no path, no query.
 *
 * Parse-and-rebuild rather than pattern-match, the same way `spotifyEmbed`
 * decides what may go in an iframe: whatever the addon wrote, what comes out
 * is an origin this file constructed.
 */
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

/* ── Manifest ────────────────────────────────────────────────────────────── */

export interface AddonContribution {
  /** Bare here, namespaced everywhere else - see `qualify`. */
  key: string;
  name: string;
}

/* ── Settings, declared rather than drawn ────────────────────────────────── */

/**
 * One setting, as a description rather than a form.
 *
 * The addon says what it needs; the *host* renders the field, with the app's
 * own components. Three reasons, in order of how much they matter:
 *
 * 1. **The host can read an addon's config without running the addon.**
 *    Guided sessions used to hand every module a `parse` function and call it,
 *    which is fine for four modules in this repo and not fine at all for code
 *    a stranger wrote. A schema is data: it can be validated at the boundary,
 *    stored, and re-read years later by a version of the app that has never
 *    loaded that addon.
 * 2. A settings form is a second sandboxed surface to build, secure and style,
 *    for what is nearly always three fields and a dropdown.
 * 3. Every addon's settings then look like the rest of the app, which is what
 *    the user is entitled to and what an addon author should not have to
 *    reimplement.
 *
 * The cost is honest and worth naming: an addon whose settings genuinely need
 * a custom interface cannot have one. That is a real limit, and it buys the
 * three things above.
 */
export type SettingField =
  | {
      key: string;
      label: string;
      type: "select";
      default: string;
      options: readonly string[];
    }
  | {
      key: string;
      label: string;
      type: "number";
      default: number;
      min?: number;
      max?: number;
    }
  | {
      key: string;
      label: string;
      type: "text";
      default: string;
      maxLength?: number;
    };

/**
 * An activity type an addon defines - a guided session of its own.
 *
 * The same four things the app's own sessions have carried since they existed
 * (`preset_key`, a blurb, a default length, a start policy), which is not a
 * coincidence: an addon's activity type is stored in exactly the columns a
 * first-party one is, with a namespaced key.
 */
export interface AddonActivityType extends AddonContribution {
  /** Finishes "When this is on, ...". See the note on `ActivityModule`. */
  blurb: string;
  defaults: {
    sessionMinutes: number;
    startPolicy: "manual" | "auto" | "prompt";
  };
  /**
   * The ground the host paints behind the session.
   *
   * `dim` is the near-black one, for a session about looking away from a
   * screen. It is the host's to paint and not the addon's, because the frame
   * around a session - and the contrast the Done button needs to stay
   * legible - is the host's. An addon says which of the two it was drawn
   * against; it does not get to paint its own.
   */
  ground?: "page" | "dim";
  settings: readonly SettingField[];
}

const START_POLICIES = ["manual", "auto", "prompt"] as const;

/** The config an activity type starts with, built from its own schema. */
export function defaultConfig(
  type: AddonActivityType,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of type.settings) config[field.key] = field.default;
  return config;
}

/**
 * Stored settings, checked against the schema that describes them.
 *
 * Never throws, and never returns a field the schema does not name. A value
 * that has gone bad - written by an older version, edited by hand, or simply
 * absent - falls back to that field's default rather than failing the whole
 * config: settings written by a newer version of an addon still have to run
 * under an older one, and a crash in a session is worse than a default.
 *
 * The same rule the app's own modules follow in `configFor`, moved to where it
 * can be applied to code nobody here wrote.
 */
export function parseConfig(
  type: AddonActivityType,
  raw: unknown,
): Record<string, unknown> {
  const stored: Record<string, unknown> =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const config: Record<string, unknown> = {};
  for (const field of type.settings) {
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
    }
  }
  return config;
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** What it asks for. What it was *given* lives in `addons.granted_json`. */
  capabilities: readonly AddonCapability[];
  widgets: readonly AddonContribution[];
  activityTypes: readonly AddonActivityType[];
}

/**
 * Read a manifest, or decide it is not one.
 *
 * Never throws, and returns null rather than a partial object: a manifest is
 * the thing a permission screen is drawn from, and half of one would ask the
 * user to approve a sentence nobody wrote. The same rule the guided-session
 * modules follow for their own config, applied to a document that arrives from
 * further away.
 *
 * Deliberately not a schema library. This is one object with seven fields
 * checked at one boundary, and the errors it must survive are "a stranger sent
 * nonsense", not "a colleague mistyped a key".
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

  const capabilities = parseCapabilities(m.capabilities);
  if (capabilities === null) return null;

  const widgets = parseContributions(m.widgets);
  const activityTypes = parseActivityTypes(m.activityTypes);
  if (widgets === null || activityTypes === null) return null;

  return {
    id,
    name: m.name as string,
    version: m.version as string,
    description: m.description as string,
    capabilities,
    widgets,
    activityTypes,
  };
}

function parseCapabilities(raw: unknown): AddonCapability[] | null {
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
      case "net:fetch": {
        const origins = c.origins;
        if (!Array.isArray(origins)) return null;
        if (!origins.every((o) => typeof o === "string")) return null;
        out.push({ kind: "net:fetch", origins: origins as string[] });
        break;
      }
      case "write:own":
      case "ui:widget":
      case "ui:session":
      case "background:wake":
      case "notify":
        out.push({ kind: c.kind });
        break;
      // An addon built against a newer app asking for something this version
      // has never heard of. Refusing the whole manifest is the safe answer:
      // silently dropping the capability would install it half-working, with
      // no sign to the user that it is missing a permission it needs.
      default:
        return null;
    }
  }
  return out;
}

function parseContributions(raw: unknown): AddonContribution[] | null {
  // Absent is empty: an addon that only contributes widgets should not have to
  // write `"activityTypes": []` to say so.
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

    const minutes = d.sessionMinutes;
    // A session is a block on someone's day, not a background job. The upper
    // bound is what stops an addon claiming an afternoon by declaring one.
    if (typeof minutes !== "number" || !Number.isInteger(minutes)) return null;
    if (minutes < 1 || minutes > 240) return null;

    const policy = d.startPolicy;
    if (typeof policy !== "string") return null;
    if (!START_POLICIES.includes(policy as (typeof START_POLICIES)[number])) {
      return null;
    }

    const settings = parseSettings(c.settings);
    if (settings === null) return null;

    const ground = c.ground;
    if (ground !== undefined && ground !== "page" && ground !== "dim") {
      return null;
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
      settings,
    });
  }
  return out;
}

/**
 * The settings schema, which the host will render fields from.
 *
 * Strict, because the host draws whatever this says: a `default` outside its
 * own `options` would put a value in the form that the form cannot represent,
 * and the user would be looking at a setting they cannot restore.
 */
function parseSettings(raw: unknown): SettingField[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  // Not a limit anyone should meet. It is here so that a manifest cannot ask
  // the host to draw ten thousand fields.
  if (raw.length > 20) return null;

  const out: SettingField[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const f = entry as Record<string, unknown>;

    if (typeof f.key !== "string" || !ADDON_KEY.test(f.key)) return null;
    if (f.key.length > 64 || seen.has(f.key)) return null;
    seen.add(f.key);

    if (typeof f.label !== "string" || f.label.length === 0) return null;
    if (f.label.length > 100) return null;

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
          key: f.key,
          label: f.label,
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
        const min = f.min === undefined ? undefined : f.min;
        const max = f.max === undefined ? undefined : f.max;
        if (min !== undefined && typeof min !== "number") return null;
        if (max !== undefined && typeof max !== "number") return null;
        if (typeof min === "number" && f.default < min) return null;
        if (typeof max === "number" && f.default > max) return null;
        out.push({
          key: f.key,
          label: f.label,
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
        out.push({
          key: f.key,
          label: f.label,
          type: "text",
          default: f.default,
          ...(typeof maxLength === "number" ? { maxLength } : {}),
        });
        break;
      }
      default:
        return null;
    }
  }
  return out;
}
