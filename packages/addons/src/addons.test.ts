import { describe, expect, test } from "vitest";
import {
  type AddonCapability,
  canAddon,
  GRANTABLE_READ_SCOPES,
  isAddonId,
  isGrantable,
  isPlainHttpsOrigin,
  ownerOf,
  parseManifest,
  qualify,
} from "./index";

/**
 * The rules an addon runs under.
 *
 * Nothing loads an addon yet, and these tests exist anyway: this is the file
 * that says what a stranger's code may do, and it is much cheaper to get right
 * before there is a loader than after there is an ecosystem.
 */

describe("identity", () => {
  test("an id may not contain the separator it is joined with", () => {
    expect(isAddonId("acme.fitness")).toBe(true);
    expect(isAddonId("acme.fitness/oops")).toBe(false);
  });

  test.each(["Acme", "acme..fitness", "", "acme fitness", "acme_fitness"])(
    "refuses the malformed id %o",
    (id) => {
      expect(isAddonId(id)).toBe(false);
    },
  );

  test("a first-party key belongs to nobody", () => {
    expect(ownerOf("up_next")).toBeNull();
  });

  test("an addon's key names its addon", () => {
    expect(ownerOf(qualify("acme.fitness", "next-workout"))).toBe(
      "acme.fitness",
    );
  });

  /**
   * A key that merely looks like an addon's is treated as first-party, where
   * it will not be found either and so draws nothing. An unrecognised key
   * leaving a gap rather than throwing is how the rail and the guided sessions
   * already behave; this keeps that true for a malformed one.
   */
  test.each(["/leading", "Acme/x", "acme.fitness/", "a/b/c"])(
    "a malformed key %o owns nothing",
    (key) => {
      expect(ownerOf(key)).toBeNull();
    },
  );
});

describe("reading the schedule", () => {
  const granted: AddonCapability[] = [
    { kind: "read:schedule", scope: "today" },
  ];

  test("today is what today allows", () => {
    expect(
      canAddon(granted, { kind: "read:schedule", scope: "today" }).ok,
    ).toBe(true);
  });

  test("a wider window than granted is refused", () => {
    const decision = canAddon(granted, {
      kind: "read:schedule",
      scope: "week",
    });
    expect(decision.ok).toBe(false);
  });

  test("a wider grant covers a narrower request", () => {
    expect(
      canAddon([{ kind: "read:schedule", scope: "week" }], {
        kind: "read:schedule",
        scope: "today",
      }).ok,
    ).toBe(true);
  });

  test("an addon granted nothing may read nothing", () => {
    expect(canAddon([], { kind: "read:schedule", scope: "today" }).ok).toBe(
      false,
    );
  });

  /**
   * The gate on the policy rather than on one user's approval.
   *
   * Widening the read scope is meant to be a deliberate act, so it is meant to
   * break a test. If this one starts failing because `GRANTABLE_READ_SCOPES`
   * grew, that is the reminder to check the server enforces the wider window
   * too - not a reason to edit the assertion.
   */
  test("only today may be granted at all, for now", () => {
    expect(GRANTABLE_READ_SCOPES).toEqual(["today"]);
    expect(isGrantable({ kind: "read:schedule", scope: "today" }).ok).toBe(
      true,
    );
    for (const scope of ["week", "range", "history"] as const) {
      expect(isGrantable({ kind: "read:schedule", scope }).ok).toBe(false);
    }
  });
});

describe("writing", () => {
  test("an addon granted write:own may write", () => {
    expect(canAddon([{ kind: "write:own" }], { kind: "write:own" }).ok).toBe(
      true,
    );
  });

  test("an addon granted only reads may not write", () => {
    expect(
      canAddon([{ kind: "read:schedule", scope: "today" }], {
        kind: "write:own",
      }).ok,
    ).toBe(false);
  });

  /**
   * There is no capability for writing someone else's slot.
   *
   * Not refused by a check - absent from the vocabulary, so it cannot be
   * asked for, granted by mistake, or reached by a manifest that names it.
   * This test is what notices if someone adds one.
   */
  test("no capability grants writing what the addon does not own", () => {
    const manifest = parseManifest({
      id: "acme.fitness",
      name: "Acme",
      version: "1.0.0",
      description: "x",
      capabilities: [{ kind: "write:any" }],
    });
    expect(manifest).toBeNull();
  });
});

describe("reaching other hosts", () => {
  const granted: AddonCapability[] = [
    { kind: "net:fetch", origins: ["https://api.acme.example"] },
  ];

  test("a declared origin is allowed", () => {
    expect(
      canAddon(granted, {
        kind: "net:fetch",
        origins: ["https://api.acme.example"],
      }).ok,
    ).toBe(true);
  });

  test("an undeclared origin is refused", () => {
    expect(
      canAddon(granted, {
        kind: "net:fetch",
        origins: ["https://evil.example"],
      }).ok,
    ).toBe(false);
  });

  // These become the `connect-src` of the frame the addon runs in, so a
  // wildcard would not merely be broad - it would make that header useless.
  test.each([
    "https://*.acme.example",
    "http://api.acme.example",
    "https://api.acme.example/v1",
    "https://user:pw@api.acme.example",
    "not a url",
  ])("%o is not grantable", (origin) => {
    expect(isPlainHttpsOrigin(origin)).toBe(false);
    expect(isGrantable({ kind: "net:fetch", origins: [origin] }).ok).toBe(
      false,
    );
  });

  test("a plain https origin is grantable", () => {
    expect(isPlainHttpsOrigin("https://api.acme.example")).toBe(true);
  });
});

describe("the manifest", () => {
  const valid = {
    id: "acme.fitness",
    name: "Acme Fitness",
    version: "1.2.0",
    description: "Today's training, in your day.",
    capabilities: [
      { kind: "read:schedule", scope: "today" },
      { kind: "write:own" },
      { kind: "ui:widget" },
    ],
    widgets: [{ key: "next-workout", name: "Next workout" }],
  };

  test("reads a manifest", () => {
    const manifest = parseManifest(valid);
    expect(manifest?.id).toBe("acme.fitness");
    expect(manifest?.capabilities).toHaveLength(3);
    expect(manifest?.widgets).toEqual([
      { key: "next-workout", name: "Next workout" },
    ]);
  });

  // An addon that only contributes widgets should not have to write an empty
  // array to say it contributes no activity types.
  test("an absent contribution list is empty, not invalid", () => {
    expect(parseManifest(valid)?.activityTypes).toEqual([]);
  });

  /**
   * A manifest is what a permission screen is drawn from, so half of one would
   * ask the user to approve a sentence nobody wrote.
   */
  test.each([
    ["not an object", 42],
    ["null", null],
    ["a bad id", { ...valid, id: "Acme Fitness" }],
    ["no capabilities array", { ...valid, capabilities: undefined }],
    ["an unknown capability", { ...valid, capabilities: [{ kind: "sudo" }] }],
    [
      "an unknown read scope",
      {
        ...valid,
        capabilities: [{ kind: "read:schedule", scope: "everything" }],
      },
    ],
    ["a widget with no name", { ...valid, widgets: [{ key: "a" }] }],
    [
      "a widget key with a slash",
      { ...valid, widgets: [{ key: "a/b", name: "x" }] },
    ],
    ["an empty name", { ...valid, name: "" }],
  ])("refuses %s", (_label, raw) => {
    expect(parseManifest(raw)).toBeNull();
  });

  test("never throws, whatever it is handed", () => {
    for (const raw of [undefined, "", [], Symbol("x"), () => {}, new Map()]) {
      expect(() => parseManifest(raw)).not.toThrow();
    }
  });
});
