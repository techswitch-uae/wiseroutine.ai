import type React from "react";
import { useState } from "react";
import "./gallery.css";
import {
  Button,
  Chip,
  DashedRow,
  LiveStatus,
  Metric,
  Module,
  ModuleEmpty,
  NavItem,
  PlayGlyph,
  Segmented,
  Slot,
  SourceMark,
  StateRow,
  Toggle,
} from "./components";

const Row: React.FC<{
  name: string;
  tag: string;
  why: React.ReactNode;
  children: React.ReactNode;
  /** Specimens too wide for the 1fr column stack under the description. */
  wide?: boolean;
}> = ({ name, tag, why, children, wide }) => (
  <div className={wide ? "gl-row gl-row-wide" : "gl-row"}>
    <div>
      <div className="gl-nm">{name}</div>
      <span className="gl-tag">{tag}</span>
      <div className="gl-why">{why}</div>
    </div>
    <div className="gl-spec">{children}</div>
  </div>
);

const Section: React.FC<{
  title: string;
  blurb: string;
  children: React.ReactNode;
}> = ({ title, blurb, children }) => (
  <section className="gl-sec">
    <div className="gl-sh">{title}</div>
    <div className="gl-sd">{blurb}</div>
    {children}
  </section>
);

const Swatch: React.FC<{
  fill: string;
  name: string;
  note: string;
  ring?: boolean;
}> = ({ fill, name, note, ring }) => (
  <div className="gl-swatch">
    <div
      style={{
        background: fill,
        boxShadow: ring ? "inset 0 0 0 1px rgba(46,43,37,.12)" : undefined,
      }}
    />
    <b>{name}</b>
    <code>{note}</code>
  </div>
);

export const Gallery: React.FC = () => {
  const [live, setLive] = useState(true);
  const [off, setOff] = useState(false);
  const [grace, setGrace] = useState<"1 min" | "3 min" | "10 min">("3 min");
  const [duration, setDuration] = useState("15 min");
  const [nav, setNav] = useState("Today");

  return (
    <div className="gl">
      <header style={{ padding: "0 4px 24px" }}>
        <div
          className="wr-label"
          style={{ fontSize: 10.5, color: "var(--wr-text-soft)" }}
        >
          Wise Routine · interface kit
        </div>
        <h1 className="wr-display-30" style={{ margin: "6px 0 0" }}>
          Components, and when to reach for them
        </h1>
        <p className="gl-sd" style={{ marginTop: 10 }}>
          Three colours and a sand family. Terracotta means{" "}
          <b>recovery and the thing you can act on</b>; ink means{" "}
          <b>focus and commitment</b>; sand carries everything the user is not
          being asked to do. Depth, not outline, separates a surface from its
          ground.
        </p>
      </header>

      <Section
        title="Foundations"
        blurb="Every value below is a token. Nothing in a screen should introduce a fourth hue or a fifth elevation."
      >
        <Row
          name="Colour roles"
          tag="token"
          why={
            <>
              Terracotta is never decorative. If a block is terracotta the user
              can start it, choose it, or it is a recovery activity. Ink is used
              for <b>one</b> element per view — the commitment. Everything else
              is sand.
            </>
          }
        >
          <div className="gl-set">
            <Swatch fill="var(--color-accent)" name="Accent" note="#c67139" />
            <Swatch
              fill="var(--color-accent-700)"
              name="Accent fill"
              note="accent-700"
            />
            <Swatch
              fill="var(--color-accent-900)"
              name="Accent text"
              note="on tint"
            />
            <Swatch fill="var(--color-text)" name="Ink" note="#201e1d" />
            <Swatch fill="var(--wr-card)" name="Card" note="neutral-100" ring />
            <Swatch fill="var(--wr-page)" name="Page" note="#f6f1e8" ring />
            <Swatch
              fill="var(--wr-recessed)"
              name="Recessed"
              note="neutral-200"
            />
            <Swatch fill="var(--wr-track)" name="Track" note="neutral-300" />
          </div>
        </Row>

        <Row
          name="Elevation"
          tag="token"
          why={
            <>
              Four steps, no more. <b>Inset</b> is not an elevation — it is the
              absence of one, used for context. Never combine a border and a
              shadow on the same edge.
            </>
          }
        >
          <div className="gl-set">
            <div
              className="gl-elev wr-elev-inset"
              style={{ background: "var(--wr-recessed)" }}
            >
              <b>Inset</b>
              <span>Context, off states</span>
            </div>
            <div className="gl-elev wr-elev-1">
              <b>Lift 1</b>
              <span>Default card, list row</span>
            </div>
            <div className="gl-elev wr-elev-2">
              <b>Lift 2</b>
              <span>Rail module, panel</span>
            </div>
            <div className="gl-elev wr-elev-3">
              <b>Lift 3</b>
              <span>Live slot, dialog</span>
            </div>
          </div>
          <div className="gl-why" style={{ marginTop: 0 }}>
            Shadows are always warm neutral (
            <code style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>
              rgba(46,43,37,·)
            </code>
            ). A tinted shadow reads as a glow and was removed from the system.
          </div>
        </Row>

        <Row
          name="Type"
          tag="token"
          why="Caprasimo for anything that names a thing — a screen, a card, a number. Figtree for everything read as a sentence. A number the user scans (a time, a count) is display type, not body type."
        >
          <div>
            <div className="wr-display-30">Display 30 / screen title</div>
            <div className="wr-display-21" style={{ marginTop: 6 }}>
              Display 21 / card title, metric
            </div>
          </div>
          <div>
            <div className="wr-body-strong">Body 13.5 semibold — item name</div>
            <div className="wr-body" style={{ marginTop: 3 }}>
              Body 12 regular — helper text, one line where possible, always in
              the rail or under the item, never as a page headline.
            </div>
            <div className="wr-label" style={{ marginTop: 8 }}>
              Label 9.5 / eyebrow · uppercase, .09em
            </div>
          </div>
        </Row>
      </Section>

      <Section
        title="Slot cards"
        blurb="The timeline is built from one component with four variants. The variant is decided by who owns the block, not by how important it looks."
      >
        <Row
          name="Slot / focus"
          tag="variant: focus"
          why={
            <>
              Something the user chose to do at a desk. <b>Ink rule</b>, lifted
              card. Completed slots keep the card and swap the trailing element
              for a Done chip — never dim the row.
            </>
          }
        >
          <Slot
            variant="focus"
            time="09:30"
            name="Deep work"
            meta="25 min · Pricing page copy"
            done
          />
          <Slot
            variant="focus"
            time="11:25"
            name="Deep work"
            meta="45 min · Roadmap"
          />
        </Row>

        <Row
          name="Slot / recovery"
          tag="variant: recovery"
          why={
            <>
              Placed by the scheduler for the body — stretch, eye rest, walk,
              breathing. <b>Terracotta rule</b>, same card as focus. Recovery is
              never visually louder than focus; the colour is the only
              difference.
            </>
          }
        >
          <Slot
            variant="recovery"
            time="13:05"
            name="Eye rest"
            meta="5 min · before three calls"
          />
        </Row>

        <Row
          name="Slot / live"
          tag="variant: live"
          why={
            <>
              The one slot that can be started right now. <b>Lift 3</b>, a Start
              button, the auto-move sentence, and a draining bar showing the
              grace period. Exactly one per view — if two are live the earlier
              one wins and the later reverts to its base variant.
            </>
          }
        >
          <Slot
            variant="live"
            time="11:00"
            name="Back & shoulder stretch"
            meta="10 min · seated 52 min · Outlook"
            autoMove="Moves itself in 3 min if you don't start"
            grace={0.7}
            onStart={() => setLive(!live)}
          />
        </Row>

        <Row
          name="Slot / external"
          tag="variant: meeting"
          why={
            <>
              A calendar event the app does not own.{" "}
              <b>Inset sand, no rule, no colour</b> — the user cannot act on it,
              so it must not compete. Height carries duration; the source mark
              goes on the right.
            </>
          }
        >
          <Slot
            variant="meeting"
            time="10:00"
            name="Design review"
            meta="Outlook · 60 min"
            source="O"
          />
        </Row>

        <Row
          name="Gap & add row"
          tag="dashed"
          why={
            <>
              Dashed{" "}
              <code style={{ fontFamily: "ui-monospace,Menlo,monospace" }}>
                #cdbe9f
              </code>{" "}
              is the system's one "nothing here yet" treatment: protected gaps,
              add rows, unplanned reminders, library chips. It never carries a
              shadow.
            </>
          }
        >
          <DashedRow>15 min free — held open</DashedRow>
          <DashedRow onClick={() => undefined}>
            <span style={{ fontWeight: 400, fontSize: 13 }}>+</span>
            Add a task or activity to today
          </DashedRow>
        </Row>
      </Section>

      <Section
        title="Actions"
        blurb="Three levels, and they are chosen by consequence, not by position on screen."
      >
        <Row
          name="Buttons"
          tag="primary · commit · secondary · quiet"
          why={
            <>
              <b>Primary (terracotta)</b> starts or schedules something — the
              physical act. <b>Commit (ink)</b> confirms or saves a decision.{" "}
              <b>Secondary</b> is sand with a hairline, never a shadow-only
              white pill: a white-on-white button fails contrast. <b>Quiet</b>{" "}
              is text only, for the escape route.
            </>
          }
        >
          <div className="gl-set">
            <Button variant="primary">
              <PlayGlyph />
              Start now
            </Button>
            <Button variant="commit">Save</Button>
            <Button variant="secondary">Plan into tomorrow</Button>
            <Button variant="quiet">Not now — find a later gap</Button>
          </div>
          <div className="gl-set">
            <Button variant="primary" disabled>
              <PlayGlyph />
              Start now
            </Button>
            <Button variant="commit" disabled>
              Save
            </Button>
          </div>
          <div className="gl-why" style={{ marginTop: 0 }}>
            Filled buttons pair <b>accent-700</b> with a white label (6.8:1);
            the lighter <b>accent</b> step is for rules, dots, bars and tints
            only — white on it measures 3.6:1 and fails.
          </div>
        </Row>

        <Row
          name="Chips"
          tag="choice · static · keycap"
          why="A chip is a choice the user makes with one tap: duration, date, frequency. Selected is a filled pill; unselected is inset sand. Static chips (Done, Paused, a count) use the same shape but carry no shadow and no hover."
        >
          <div className="gl-set">
            {["10 min", "15 min", "25 min"].map((d) => (
              <Chip
                key={d}
                variant={d === duration ? "selected" : "inset"}
                onClick={() => setDuration(d)}
              >
                {d}
              </Chip>
            ))}
            <Chip variant="ink">Mon 18 Aug</Chip>
            <Chip variant="static">Paused</Chip>
            <Chip variant="static">Done</Chip>
            <Chip variant="dashed">+ Hydration</Chip>
            <Chip variant="key" className="wr-chip-selected">
              ↵
            </Chip>
            <Chip variant="key">2</Chip>
          </div>
        </Row>

        <Row
          name="Toggle & segmented"
          tag="form"
          why={
            <>
              A toggle turns a whole behaviour on: an activity, a module, a
              calendar write. Off is an inset track —{" "}
              <b>the row itself never dims</b>, because a dimmed row reads as
              unavailable rather than off. Segmented controls are for
              three-or-fewer mutually exclusive values with short labels.
            </>
          }
        >
          <div className="gl-set">
            <Toggle checked={live} onChange={setLive} label="Adapt live" />
            <Toggle checked={off} onChange={setOff} label="Tomorrow's shape" />
            <Segmented
              label="Grace period"
              options={["1 min", "3 min", "10 min"] as const}
              value={grace}
              onChange={setGrace}
            />
          </div>
        </Row>
      </Section>

      <Section
        title="Rail modules"
        blurb="Every module is the same card at Lift 2 with an eyebrow, a body and at most one action. Modules are user-toggleable and reorderable, so none may depend on its neighbour or on being first."
      >
        <Row
          name="Module / attention"
          tag="ink"
          why={
            <>
              The ink module is the app's single loudest element and there is{" "}
              <b>one per screen</b>: what to do next. If a second candidate
              appears, it becomes a normal module.
            </>
          }
        >
          <Module variant="attention" eyebrow="Up next · 11:00">
            <div className="wr-display-21" style={{ marginTop: 6 }}>
              Back &amp; shoulder stretch
            </div>
            <div
              className="wr-body"
              style={{
                color: "color-mix(in srgb, #f9f4ed 78%, transparent)",
                marginTop: 5,
              }}
            >
              10 min, guided. Ends before your 11:25 focus block.
            </div>
            <Button variant="primary" block style={{ marginTop: 14 }}>
              <PlayGlyph />
              Start now
            </Button>
            <Button
              variant="quiet"
              block
              style={{ color: "inherit", opacity: 0.78 }}
            >
              Not now — find a later gap
            </Button>
          </Module>
        </Row>

        <Row
          name="Module / list"
          tag="default"
          why="Two or three items with a reason on the right, then one secondary action. Misses are stated plainly and stay uncoloured — the product's position is that a missed slot is information, not a failure."
        >
          <Module eyebrow="Missed today" count={2}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginTop: 11,
              }}
            >
              <div style={{ display: "flex", gap: 9 }}>
                <span style={{ font: "600 12.5px var(--font-body)", flex: 1 }}>
                  Eye rest
                </span>
                <span className="wr-body">08:20 · no gap</span>
              </div>
              <div style={{ display: "flex", gap: 9 }}>
                <span style={{ font: "600 12.5px var(--font-body)", flex: 1 }}>
                  Breathing
                </span>
                <span className="wr-body">skipped twice</span>
              </div>
            </div>
            <Button variant="secondary" block style={{ marginTop: 13 }}>
              Plan into tomorrow
            </Button>
          </Module>
        </Row>

        <Row
          name="Module / metric"
          tag="default"
          why="Progress against a minimum, never a goal or a streak to protect. Recovery bars are terracotta; focus time is ink; the track is neutral-300. Numbers are display type so they can be scanned."
        >
          <Module eyebrow="Today so far">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginTop: 11,
              }}
            >
              <Metric label="Movement" value="1 / 3" progress={0.33} />
              <Metric
                label="Focused time"
                value="50 m / 2 h"
                progress={0.42}
                tone="focus"
              />
            </div>
          </Module>
        </Row>

        <Row
          name="Module / empty slot"
          tag="dashed"
          why={`The dashboard is modular, so the rail always ends with an add affordance. Same dashed treatment as a calendar gap: both mean "space you can fill".`}
        >
          <ModuleEmpty>Add a dashboard module</ModuleEmpty>
        </Row>
      </Section>

      <Section
        title="Structure & metadata"
        blurb="Sand chrome, near-white page, lifted content. The sidebar is neutral-200 everywhere so nothing looks like a different app."
      >
        <Row
          name="App frame"
          tag="layout"
          wide
          why={
            <>
              The sidebar is <b>neutral-200</b> everywhere — window bar, sidebar
              and any settings pane share one tone. The page never carries a
              headline; the date sits inline with a helper sentence, and
              everything explanatory belongs in the rail.
            </>
          }
        >
          <div className="wr-frame">
            <div className="wr-titlebar">
              <i />
              <i />
              <i />
              <span style={{ marginLeft: 12 }}>Wise Routine</span>
            </div>
            <div style={{ display: "flex" }}>
              <nav className="wr-sidebar">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    paddingLeft: 6,
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 999,
                      background: "var(--color-text)",
                    }}
                  />
                  <span
                    style={{ fontFamily: "var(--font-heading)", fontSize: 15 }}
                  >
                    Wise Routine
                  </span>
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 1 }}
                >
                  {(
                    [
                      ["Today", undefined],
                      ["Week", undefined],
                      ["Activities", undefined],
                      ["Reminders", 3],
                      ["Calendars", undefined],
                    ] as const
                  ).map(([label, count]) => (
                    <NavItem
                      key={label}
                      active={nav === label}
                      count={count}
                      onClick={() => setNav(label)}
                    >
                      {label}
                    </NavItem>
                  ))}
                </div>
                <Module eyebrow="Sitting streak" style={{ width: "100%" }}>
                  <div className="wr-display-21" style={{ marginTop: 3 }}>
                    52 min
                  </div>
                  <div className="wr-body">A stretch is queued next</div>
                </Module>
                <div style={{ marginTop: "auto" }}>
                  <Button
                    variant="commit"
                    block
                    style={{ justifyContent: "flex-start" }}
                  >
                    + Quick add
                    <span
                      style={{
                        marginLeft: "auto",
                        font: "600 10.5px ui-monospace,Menlo,monospace",
                        opacity: 0.5,
                      }}
                    >
                      ⌘K
                    </span>
                  </Button>
                </div>
              </nav>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "24px 26px 28px",
                  background: "var(--wr-page)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 10 }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 20,
                      }}
                    >
                      Tuesday, 11 August
                    </span>
                    <span
                      style={{
                        font: "600 12px var(--font-body)",
                        color: "var(--wr-text-muted)",
                      }}
                    >
                      Four recovery slots found
                    </span>
                  </div>
                  <LiveStatus>Adapting live · Google, Outlook</LiveStatus>
                </div>
                <Slot
                  variant="focus"
                  time="09:30"
                  name="Deep work"
                  meta="25 min"
                  done
                />
                <Slot
                  variant="meeting"
                  time="10:00"
                  name="Design review"
                  meta="Outlook · 60 min"
                  source="O"
                />
                <Slot
                  variant="live"
                  time="11:00"
                  name="Back & shoulder stretch"
                  meta="10 min · seated 52 min"
                  autoMove="Moves itself in 3 min if you don't start"
                  grace={0.7}
                />
                <DashedRow>15 min free — held open</DashedRow>
              </div>
            </div>
          </div>
        </Row>

        <Row
          name="Calendar source mark"
          tag="metadata"
          why={`One neutral mark per provider, always trailing the item it belongs to. It answers "where did this come from" and is deliberately colourless — provenance is not a category, and provider brand colours would break the three-colour rule.`}
        >
          <div className="gl-set">
            <SourceMark provider="G" />
            <SourceMark provider="O" />
            <LiveStatus>Adapting live · Google, Outlook</LiveStatus>
          </div>
        </Row>

        <Row
          name="Time column"
          tag="layout"
          why="A fixed 48px gutter. The live slot's time is the only one in accent-900 and bold — it is how the eye finds “now” without the card needing a colour fill."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className="wr-time" style={{ paddingTop: 0 }}>
                10:00
              </span>
              <span className="wr-body">default</span>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className="wr-time wr-time-now" style={{ paddingTop: 0 }}>
                11:00
              </span>
              <span className="wr-body">now</span>
            </div>
          </div>
        </Row>

        <Row
          name="State treatments"
          tag="rule"
          why={
            <>
              The system has no opacity-based disabled state. <b>Done</b> = a
              chip. <b>Paused</b> = hollow rule plus a chip. <b>Off</b> = inset
              surface plus a toggle. <b>Unplanned</b> = dashed. Dimming was
              removed everywhere: it reads as "broken" rather than "not now",
              and it pushes text under the 4.5:1 floor.
            </>
          }
        >
          <div className="gl-set">
            <StateRow
              name="Breathing"
              leading={<span className="wr-rule wr-rule-hollow" />}
              trailing={<Chip variant="static">Paused</Chip>}
            />
            <StateRow
              recessed
              name="Tomorrow's shape"
              leading={
                <span
                  style={{
                    font: "400 13px var(--font-body)",
                    color: "var(--wr-text-soft)",
                    letterSpacing: 2,
                  }}
                >
                  ⋮⋮
                </span>
              }
              trailing={
                <Toggle
                  checked={off}
                  onChange={setOff}
                  label="Tomorrow's shape"
                />
              }
            />
          </div>
        </Row>
      </Section>
    </div>
  );
};
