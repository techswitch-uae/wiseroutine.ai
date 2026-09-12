import { canAddon, cardHeightFor, parseConfig } from "/contract.js";

const $ = (id) => document.getElementById(id);
const manifest = await fetch("/manifest.json").then((response) =>
  response.json(),
);
const roles = [
  ...manifest.widgets.map((widget) => ({
    kind: "widget",
    widgetKey: widget.key,
  })),
  ...manifest.activityTypes.map((type) => ({
    kind: "session",
    activityTypeKey: type.key,
  })),
  { kind: "background" },
];
for (const [index, role] of roles.entries()) {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = `${role.kind}: ${role.widgetKey ?? role.activityTypeKey ?? "Quick Add"}`;
  $("role").append(option);
}
manifest.capabilities.forEach((cap, index) => {
  const label = document.createElement("label"),
    input = document.createElement("input");
  input.type = "checkbox";
  input.checked = true;
  input.value = String(index);
  label.append(input, document.createTextNode(JSON.stringify(cap)));
  $("permissions").append(label);
});
for (const item of manifest.quickAdd) {
  const option = document.createElement("option");
  option.value = item.key;
  option.textContent = item.name;
  $("quickKey").append(option);
}
let port,
  requestId = 1;
const note = (text) => {
  $("log").textContent = `${text}\n${$("log").textContent}`.slice(0, 12000);
};
function disconnect() {
  port?.close();
  port = null;
  $("frame").replaceChildren();
  $("status").textContent = "Disconnected";
}
function restart() {
  disconnect();
  const role = roles[Number($("role").value)];
  const granted = [...$("permissions").querySelectorAll("input:checked")].map(
    (input) => manifest.capabilities[Number(input.value)],
  );
  const require = (cap) => {
    const decision = canAddon(granted, cap);
    if (!decision.ok) throw new Error(decision.reason);
  };
  const origin = Date.now(),
    dayStart = origin - 3600000,
    dayEnd = origin + 7 * 3600000;
  const slots = [
    {
      id: "synthetic-slot",
      title: "Synthetic focus",
      kind: "focus",
      startsAt: origin,
      endsAt: origin + 120000,
      status: "started",
      ownedByYou: false,
    },
  ];
  const todos = [
    {
      id: "synthetic-todo",
      title: "Try this preview",
      minutes: 10,
      status: "open",
      slotId: null,
    },
  ];
  const storage = new Map();
  let writes = 0;
  const addSlot = (value, ownedByYou) => {
    if (
      !Number.isFinite(value.startsAt) ||
      !Number.isFinite(value.endsAt) ||
      value.startsAt < origin ||
      value.endsAt > dayEnd ||
      value.endsAt <= value.startsAt ||
      slots.some(
        (slot) =>
          !["completed", "skipped"].includes(slot.status) &&
          slot.startsAt < value.endsAt &&
          value.startsAt < slot.endsAt,
      )
    )
      throw new Error("No synthetic gap at that time");
    if (++writes > 100) throw new Error("Synthetic write quota exceeded");
    const slot = {
      ...value,
      id: crypto.randomUUID(),
      status: "planned",
      ownedByYou,
    };
    slots.push(slot);
    return slot;
  };
  const own = (id) => {
    require({ kind: "write:own" });
    const slot = slots.find((slot) => slot.id === id && slot.ownedByYou);
    if (!slot) throw new Error("Not an addon-owned slot");
    return slot;
  };
  const todo = (id) => {
    const item = todos.find((item) => item.id === id);
    if (!item) throw new Error("No such synthetic todo");
    return item;
  };
  const handlers = {
    settings: () => parseConfig(manifest, {}),
    session: () => {
      require({ kind: "ui:session" });
      if (role.kind !== "session") throw new Error("Not a session frame");
      return {
        slot: slots[0],
        config: parseConfig(
          manifest.activityTypes.find(
            (type) => type.key === role.activityTypeKey,
          ),
          {},
        ),
        activityTypeKey: role.activityTypeKey,
      };
    },
    finishSession: () => {
      require({ kind: "ui:session" });
      if (role.kind !== "session") throw new Error("Not a session frame");
      $("status").textContent = "Synthetic session completed";
    },
    day: () => {
      require({ kind: "read:schedule", scope: "today" });
      return { dayStart, dayEnd, timeZone: "UTC", slots };
    },
    card: ({ card }) => {
      require({ kind: "ui:widget" });
      if (role.kind !== "widget") throw new Error("Not a widget frame");
      frame.style.height = `${card ? cardHeightFor(card.height) : 0}px`;
    },
    placeSlot: ({ title, kind, minutes, startsAt, preferredAt }) => {
      require({ kind: "write:own" });
      if (
        typeof title !== "string" ||
        !title.trim() ||
        !["task", "focus", "recovery"].includes(kind) ||
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > 240
      )
        throw new Error("Invalid slot request");
      const candidates = [
        ...(Array.isArray(preferredAt) ? preferredAt.slice(0, 10) : []),
        origin + 180000,
        ...slots.map((slot) => slot.endsAt),
      ];
      const start =
        startsAt ??
        candidates.find(
          (at) =>
            Number.isFinite(at) &&
            at >= origin &&
            at + minutes * 60000 <= dayEnd &&
            !slots.some(
              (slot) =>
                !["completed", "skipped"].includes(slot.status) &&
                slot.startsAt < at + minutes * 60000 &&
                at < slot.endsAt,
            ),
        );
      return addSlot(
        {
          title: title.slice(0, 200),
          kind,
          startsAt: start,
          endsAt: start + minutes * 60000,
        },
        true,
      );
    },
    setSlotStatus: ({ slotId, status }) => {
      if (!["completed", "skipped"].includes(status))
        throw new Error("Invalid slot status");
      own(slotId).status = status;
    },
    "todos.list": () => {
      require({ kind: "read:todos" });
      return todos;
    },
    "todos.add": ({ title, minutes }) => {
      require({ kind: "write:todos" });
      if (
        typeof title !== "string" ||
        !title.trim() ||
        title.length > 500 ||
        (minutes != null &&
          (!Number.isInteger(minutes) || minutes < 1 || minutes > 480))
      )
        throw new Error("Invalid todo");
      if (++writes > 100) throw new Error("Synthetic write quota exceeded");
      const item = {
        id: crypto.randomUUID(),
        title,
        minutes: minutes ?? null,
        status: "open",
        slotId: null,
      };
      todos.push(item);
      return item;
    },
    "todos.set": ({ id, status }) => {
      require({ kind: "write:todos" });
      if (!["done", "dropped"].includes(status))
        throw new Error("Invalid todo status");
      todo(id).status = status;
    },
    "todos.place": ({ id, startsAt }) => {
      require({ kind: "write:todos" });
      const item = todo(id);
      const start = startsAt ?? origin + 180000;
      const slot = addSlot(
        {
          title: item.title,
          kind: "task",
          startsAt: start,
          endsAt: start + (item.minutes ?? 15) * 60000,
        },
        false,
      );
      item.status = "slotted";
      item.slotId = slot.id;
      return slot;
    },
    "store.get": ({ key }) => {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new Error("Invalid key");
      return storage.get(key);
    },
    "store.set": ({ key, value }) => {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new Error("Invalid key");
      if (value === undefined) {
        storage.delete(key);
        return;
      }
      const next = new Map(storage);
      next.set(key, value);
      if (
        next.size > 64 ||
        new TextEncoder().encode(JSON.stringify(value)).length > 16384 ||
        new TextEncoder().encode(JSON.stringify([...next])).length > 262144
      )
        throw new Error("Storage quota exceeded");
      storage.set(key, value);
    },
    notify: ({ title, body }) => {
      require({ kind: "notify" });
      note(
        `Notification: ${String(title).slice(0, 80)} ${String(body ?? "").slice(0, 200)}`,
      );
    },
    fetch: () => {
      throw new Error("Network proxy unavailable in synthetic preview");
    },
    openExternal: () => {
      throw new Error("External links unavailable in synthetic preview");
    },
  };
  const frame = document.createElement("iframe");
  frame.title = "Addon preview";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.addEventListener("load", () => {
    const channel = new MessageChannel();
    port?.close();
    port = channel.port1;
    let calls = 0,
      windowAt = Date.now();
    port.onmessage = (event) => {
      const message = event.data;
      if (message?.event === "quickAdd:done") {
        note(`Quick Add result: ${JSON.stringify(message)}`);
        return;
      }
      const { id, method, params } = message ?? {};
      if (!Number.isSafeInteger(id) || typeof method !== "string") return;
      try {
        if (Date.now() - windowAt > 1000) {
          calls = 0;
          windowAt = Date.now();
        }
        if (
          ++calls > 60 ||
          new TextEncoder().encode(JSON.stringify(params ?? null)).length >
            65536
        )
          throw new Error("RPC limit exceeded");
        if (!Object.hasOwn(handlers, method)) throw new Error("Unknown method");
        const result = handlers[method](params ?? {});
        port.postMessage({ id, result });
        note(`${method}: OK`);
      } catch (error) {
        port.postMessage({
          id,
          error: { kind: "denied", message: error.message },
        });
        note(`${method}: denied: ${error.message}`);
      }
    };
    frame.contentWindow.postMessage(
      {
        type: "wiseroutine:addon:port",
        role,
        theme: {
          text: "#292924",
          muted: "#66665f",
          background: "#faf9f6",
          hairline: "#ccc",
          track: "#ddd",
          accent: "#806844",
          fontBody: "system-ui",
          fontHeading: "system-ui",
        },
        hostVersion: 1,
        apiVersion: 1,
      },
      "*",
      [channel.port2],
    );
    $("status").textContent = "Connected to synthetic host";
  });
  frame.src = "/frame";
  $("frame").append(frame);
}
$("reload").onclick = restart;
$("disconnect").onclick = disconnect;
$("quick").onclick = () => {
  if (!$("quickKey").value) return;
  port?.postMessage({
    event: "quickAdd",
    requestId: requestId++,
    request: {
      key: $("quickKey").value,
      title: $("title").value,
      minutes: null,
    },
  });
};
restart();
