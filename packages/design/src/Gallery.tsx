import type React from "react";
import { useState } from "react";
import "./gallery.css";
import {
  Button,
  CalendarPicker,
  Card,
  Chip,
  ClashRow,
  CodeInput,
  DashedRow,
  DayGrid,
  DragPlacement,
  Field,
  FitStrip,
  HoursMenu,
  LiveStatus,
  Metric,
  Module,
  ModuleEmpty,
  NavItem,
  OutsideRange,
  PlanNote,
  PlayGlyph,
  ProviderButton,
  ProviderChoice,
  Rule,
  Segmented,
  SetupModule,
  Slot,
  SourceMark,
  StateRow,
  TimeStepper,
  Toggle,
  UpdatePill,
} from "./components";
import { TODAY_FIXTURE } from "./fixtures";
import {
  AccountScreen,
  AppSidebar,
  CheckEmailScreen,
  type DayHoursDraft,
  DayHoursSection,
  PlacingScreen,
  SignInScreen,
  SittingStreak,
  TodayScreen,
} from "./screens";

/** A fixed 09:00 UTC, so the specimen never shifts with the clock. */
const GRID_DAY_START = Date.UTC(2026, 7, 27, 9, 0, 0);

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
  const [email, setEmail] = useState("mara@studio.com");
  const [code, setCode] = useState("418");
  const [draftName, setDraftName] = useState("Mara Kovac");
  const [hours, setHours] = useState("working");
  const [dayHours, setDayHours] = useState<DayHoursDraft>({
    dayStartMinutes: 8 * 60 + 30,
    dayEndMinutes: 17 * 60 + 30,
    custom: {
      label: "Studio evenings",
      startMinutes: 17 * 60,
      endMinutes: 22 * 60,
    },
    dayOpensOn: "working",
    showOutsideRange: true,
  });

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
              for <b>one</b> element per view - the commitment. Everything else
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
              Four steps, no more. <b>Inset</b> is not an elevation - it is the
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
          why="Caprasimo for anything that names a thing - a screen, a card, a number. Figtree for everything read as a sentence. A number the user scans (a time, a count) is display type, not body type."
        >
          <div>
            <div className="wr-display-30">Display 30 / screen title</div>
            <div className="wr-display-21" style={{ marginTop: 6 }}>
              Display 21 / card title, metric
            </div>
          </div>
          <div>
            <div className="wr-body-strong">Body 13.5 semibold - item name</div>
            <div className="wr-body" style={{ marginTop: 3 }}>
              Body 12 regular - helper text, one line where possible, always in
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
              for a Done chip - never dim the row.
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
              Placed by the scheduler for the body - stretch, eye rest, walk,
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
              grace period. Exactly one per view - if two are live the earlier
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
              <b>Inset sand, no rule, no colour</b> - the user cannot act on it,
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
          <DashedRow>15 min free - held open</DashedRow>
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
              <b>Primary (terracotta)</b> starts or schedules something - the
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
            <Button variant="quiet">Not now - find a later gap</Button>
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
            only - white on it measures 3.6:1 and fails.
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
              calendar write. Off is an inset track -{" "}
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
              Not now - find a later gap
            </Button>
          </Module>
        </Row>

        <Row
          name="Module / list"
          tag="default"
          why="Two or three items with a reason on the right, then one secondary action. Misses are stated plainly and stay uncoloured - the product's position is that a missed slot is information, not a failure."
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
              The sidebar is <b>neutral-200</b> everywhere - window bar, sidebar
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
                <DashedRow>15 min free - held open</DashedRow>
              </div>
            </div>
          </div>
        </Row>

        <Row
          name="Calendar source mark"
          tag="metadata"
          why={`One neutral mark per provider, always trailing the item it belongs to. It answers "where did this come from" and is deliberately colourless - provenance is not a category, and provider brand colours would break the three-colour rule.`}
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
          why="A fixed 48px gutter. The live slot's time is the only one in accent-900 and bold - it is how the eye finds “now” without the card needing a colour fill."
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

      <Section
        title="Placement by hand"
        blurb="Free users put every slot where it goes, so the kit needs the intermediate states a scheduler would otherwise hide: the drag, the exact time, and the clash. All three are built from components above - nothing here is a new surface."
      >
        <Row
          name="Slot / dragging"
          tag="variant: dragging"
          wide
          why={
            <>
              Two halves. The <b>target stretch</b> reads its own range, so the
              drop is legible without the card. The <b>floating card</b> is the
              base slot at <b>Lift 3</b> - the one element allowed to move with
              the cursor. It offsets down and right of the target so both stay
              readable; it does not tilt, scale or fade. The target uses accent-
              <b>200</b> where a standing proposal uses accent-100: a live drag
              is louder, and the two never appear at once.
            </>
          }
        >
          <DragPlacement
            time="11:30"
            range="11:30–11:40"
            name="Shoulder stretch"
            at="11:30"
          />
        </Row>

        <Row
          name="Time stepper"
          tag="form"
          why={
            <>
              The step size and the consequence are stated beside the value -
              never inferred from the widget. Under it a <b>fit strip</b>: six
              bars across the surrounding window, darker where the time matches
              the user's own history. It is a hint, not a control, and it never
              blocks a choice.
            </>
          }
        >
          <div style={{ width: 340 }}>
            <TimeStepper value="11:05" note="5 min steps · ends 11:15" />
            <div style={{ marginTop: 14 }}>
              <FitStrip
                values={[0.2, 0.5, 0.9, 0.5, 0.2, 0.2]}
                caption="Darker means it fits your usual window for this activity."
              />
            </div>
          </div>
        </Row>

        <Row
          name="Clash row"
          tag="variant: clash"
          why={
            <>
              A slot the user must resolve keeps its card and gains a second
              tier: the reason, then the escape routes as choice chips and one
              quiet Drop. A clash that resolves itself - a length change rather
              than a move - drops to the <b>inset</b> surface with a neutral
              rule, because it is information plus one button, not a decision.
            </>
          }
        >
          <ClashRow
            name="Shoulder stretch · 11:05"
            reason="Inside Design review, 25 min of overlap"
            alternatives={["11:30", "12:45"]}
            dismiss="Drop"
          />
          <ClashRow
            name="Deep work · 11:25"
            reason="5 min of overlap - shortening it to 20 min clears it"
            action="Shorten"
          />
        </Row>

        <Row
          name="Plan note"
          tag="dashed"
          why={
            <>
              How the product mentions Pro: dashed edge, no fill, no shadow -
              the same treatment as an empty gap, because that is what it is. It
              states what would have happened in past tense and never covers,
              blocks or dims the thing the user is doing. One per screen at
              most, and never on the ink module.
            </>
          }
        >
          <PlanNote title="Pro would have moved both at 11:32">
            To 11:40 and 11:55, with an undo. You would have read a notification
            instead of fixing a list.
          </PlanNote>
        </Row>

        <Row
          name="Slot / suggested"
          tag="variant: suggested"
          why={
            <>
              A slot the scheduler proposes but the user has not accepted - Pro
              only. <b>Accent-100 with a ring, no shadow</b>: it is not yet a
              real thing on the page, so it does not lift. Free never shows this
              variant; the same row is a dashed gap.
            </>
          }
        >
          <Slot
            variant="suggested"
            time="11:00"
            name="Shoulder stretch"
            meta="10 min · after the review"
          />
          <DashedRow>15 min free - held open</DashedRow>
        </Row>
      </Section>

      <Section
        title="App frame"
        blurb="Sand chrome, near-white page, lifted content. The window bar and the sidebar share one tone so nothing looks like a different app, and the page never carries a headline - the date sits inline with a helper sentence."
      >
        <Row
          name="Sidebar & user menu"
          tag="layout"
          wide
          why={
            <>
              Brand, destinations, an optional module, then the two things
              always within reach: quick add on ink, and the user. The menu is a
              popover at <b>Lift 3</b> - the floating-surface step it shares
              with the live slot - because only one element may be off the page
              at a time. Click the name to open it.
            </>
          }
        >
          <div style={{ width: 200 }}>
            <AppSidebar active="today">
              <SittingStreak value="52 min" note="A stretch is queued next" />
            </AppSidebar>
          </div>
        </Row>
      </Section>

      <Section
        title="Blocks"
        blurb="One raised block, used for every grouped thing on a settings page. Account had four of these naming themselves four different ways - two through a field label, two through a loose span - and Calendars drew the same groups flat, which said the two pages were built from different materials."
      >
        <Row
          name="Card"
          tag="title · note · action"
          wide
          why={
            <>
              The title is the card's own heading rather than a label on the
              control inside it, which is why <code>Field</code> and{" "}
              <code>SelectField</code> take an optional label: naming the card
              and then naming the input says the same word twice. An unlabelled
              field still needs an accessible name, so the caller passes{" "}
              <code>aria-label</code> - only it knows what the title above says.
            </>
          }
        >
          <div style={{ width: 420, display: "grid", gap: 12 }}>
            <Card title="Name">
              <Field aria-label="Name" defaultValue="Mara K." />
            </Card>
            <Card
              title="Google · mara@studio.com"
              note="Reading 2 of 4 calendars"
              action={<Button variant="quiet">Disconnect</Button>}
            >
              <CalendarPicker
                calendars={[
                  { id: "1", name: "Work", isSelected: true, isPrimary: true },
                  { id: "2", name: "Personal", isSelected: false },
                ]}
                onToggle={() => undefined}
              />
            </Card>
            <Card>A card with nothing to name is still a card.</Card>
          </div>
        </Row>
      </Section>

      <Section
        title="Getting a calendar in"
        blurb="The first run has one real problem: the day is empty because we cannot see the user's calendar. The rail says so and offers the one action that fixes it, rather than a wizard standing between them and the day that makes the ask make sense."
      >
        <Row
          name="Set up module"
          tag="rail · dismissable"
          why={
            <>
              Only the step in hand carries its explanation and its button - the
              ones after it are titles, because a checklist that argues for all
              of itself at once is a wall of text. The tick well is always drawn
              so labels do not reflow as steps complete. Dismissing is
              permanent, and the module also retires itself the moment a
              calendar is connected.
            </>
          }
        >
          <div style={{ width: 250, display: "grid", gap: 12 }}>
            <SetupModule
              tone="dark"
              steps={[
                {
                  key: "cal",
                  label: "Connect a calendar",
                  detail:
                    "Google or Outlook. We only read your times - nothing is ever written back.",
                  action: { label: "Connect", onClick: () => undefined },
                },
                { key: "act", label: "Add two activities" },
                { key: "hrs", label: "Confirm working hours" },
              ]}
              onDismiss={() => undefined}
            />
            <SetupModule
              steps={[
                {
                  key: "cal",
                  label: "Connect a calendar",
                  detail:
                    "Google or Outlook. We only read your times - nothing is ever written back.",
                  action: { label: "Connect", onClick: () => undefined },
                },
                { key: "act", label: "Add two activities" },
                { key: "hrs", label: "Confirm working hours" },
              ]}
              onDismiss={() => undefined}
            />
            <SetupModule
              steps={[
                { key: "cal", label: "Connect a calendar", done: true },
                {
                  key: "act",
                  label: "Add two activities",
                  detail: "Two is enough to see how a day fills in.",
                  action: { label: "Add one", onClick: () => undefined },
                },
                { key: "hrs", label: "Confirm working hours" },
              ]}
              onDismiss={() => undefined}
            />
          </div>
        </Row>

        <Row
          name="Provider choice"
          tag="read-only"
          wide
          why={
            <>
              The paragraph underneath is not boilerplate. This is the moment
              someone hands over their calendar, and it answers the question
              they are actually asking before they have to go hunting for a
              privacy page. The design also offered a "write my slots to" step;
              it is gone, because the app does not write to anyone's calendar
              and offering the choice would describe a capability that is not
              there.
            </>
          }
        >
          <div style={{ width: 420 }}>
            <ProviderChoice onChoose={() => undefined} />
          </div>
        </Row>

        <Row
          name="Calendar picker"
          tag="which ones we read"
          why={
            <>
              Shown after consent, and again on the Calendars page whenever
              someone wants to change their mind. Toggling is optimistic - a
              checkbox that waits on a round trip feels broken - and a refusal
              puts it back rather than leaving the box claiming a state the
              server rejected.
            </>
          }
        >
          <div style={{ width: 380 }}>
            <CalendarPicker
              calendars={[
                {
                  id: "1",
                  name: "Work",
                  isSelected: true,
                  isPrimary: true,
                  note: "32 events this week",
                },
                {
                  id: "2",
                  name: "Personal",
                  isSelected: true,
                  note: "6 events this week",
                },
                {
                  id: "3",
                  name: "Team holidays",
                  isSelected: false,
                  note: "all-day only",
                },
                {
                  id: "4",
                  name: "Birthdays",
                  isSelected: false,
                  note: "all-day only",
                },
              ]}
              onToggle={() => undefined}
            />
          </div>
        </Row>
      </Section>

      <Section
        title="Keeping the app current"
        blurb="A new version is ready, not urgent. It gets a pill in the rail rather than a dialog, because there is no decision in it worth interrupting someone mid-sentence for - and the only thing accepting it costs them is the restart it warns about."
      >
        <Row
          name="Update pill"
          tag="idle · installing · failed"
          why={
            <>
              Once it is running it stops being a button: the one action it
              offered is already happening and the app is about to restart
              underneath them. The bar is a width rather than a spinner, except
              where there is no total to measure against - a redirect to a CDN
              that sends no length gets a travelling stripe instead of a
              percentage nobody can trust.
            </>
          }
        >
          <div style={{ width: 200, display: "grid", gap: 10 }}>
            <UpdatePill version="0.2.0" onInstall={() => undefined} />
            <UpdatePill
              version="0.2.0"
              percent={42}
              onInstall={() => undefined}
            />
            <UpdatePill
              version="0.2.0"
              percent={null}
              onInstall={() => undefined}
            />
            <UpdatePill
              version="0.2.0"
              problem="the server hung up"
              onInstall={() => undefined}
            />
          </div>
        </Row>
      </Section>

      <Section
        title="The day as a surface"
        blurb="A ruled grid rather than a list of rows. A list gives every block its own start time and nothing to read it against, so a day of 11:58, 12:23, 12:48 looks like a series of mistakes - it is not, that is simply where the gaps were. The ruler is what makes that legible."
      >
        <Row
          name="Day grid"
          tag="adaptive 5-minute rows"
          wide
          why={
            <>
              Time is not linear here. A stretch something occupies gets room to
              be read; an empty one collapses to a dotted measure mark and only
              the hour is labelled. Dead time still exists - the ruler ticks
              through it, so the shape of the day survives - it just stops
              costing a screen. The ruler is a real grid of five-minute rows, so
              a row grows to whatever the card in it needs and the line below
              moves with it: the live block here wants a Start button and gets
              the room for one instead of overflowing the next block. Two things
              at once take a lane each rather than stacking.
            </>
          }
        >
          <div style={{ width: 560 }}>
            <DayGrid
              dayStart={GRID_DAY_START}
              dayEnd={GRID_DAY_START + 6 * 60 * 60_000}
              timeZone="UTC"
              now={GRID_DAY_START + 82 * 60_000}
              items={[
                {
                  key: "a",
                  startsAt: GRID_DAY_START + 8 * 60_000,
                  endsAt: GRID_DAY_START + 33 * 60_000,
                  node: (
                    <Slot
                      variant="focus"
                      time=""
                      name="Deep work"
                      meta="25 min"
                    />
                  ),
                },
                {
                  key: "b",
                  startsAt: GRID_DAY_START + 60 * 60_000,
                  endsAt: GRID_DAY_START + 105 * 60_000,
                  node: (
                    <Slot
                      variant="meeting"
                      time=""
                      name="Product Operations Check-in"
                      meta="45 min"
                      source="M"
                    />
                  ),
                },
                {
                  key: "b2",
                  startsAt: GRID_DAY_START + 75 * 60_000,
                  endsAt: GRID_DAY_START + 105 * 60_000,
                  node: (
                    <Slot
                      variant="meeting"
                      time=""
                      name="Design review (double-booked)"
                      meta="30 min"
                      source="G"
                    />
                  ),
                },
                {
                  key: "c",
                  startsAt: GRID_DAY_START + 128 * 60_000,
                  endsAt: GRID_DAY_START + 143 * 60_000,
                  node: (
                    <Slot
                      variant="recovery"
                      time=""
                      name="Back & shoulder stretch"
                      meta="15 min"
                    />
                  ),
                },
                {
                  key: "d",
                  startsAt: GRID_DAY_START + 165 * 60_000,
                  endsAt: GRID_DAY_START + 180 * 60_000,
                  node: (
                    <Slot
                      variant="live"
                      time=""
                      name="Walk to the window"
                      meta="15 min"
                      onStart={() => undefined}
                    />
                  ),
                },
              ]}
            />
          </div>
        </Row>
      </Section>

      <Section
        title="Getting in"
        blurb="The screens before an account exists. They are the only ones that carry a headline, and the only ones with no navigation - there is nothing to navigate to and nobody to name yet. The emailed code is the path everything else is an alternative to."
      >
        <Row
          name="Field"
          tag="input"
          why={
            <>
              A pill on the card surface, with a real label rather than a
              placeholder - a placeholder disappears exactly when the user wants
              to check what they typed. The accent ring <i>is</i> the focus
              state; the browser's own outline is suppressed.
            </>
          }
        >
          <div style={{ width: 320 }}>
            <Field
              label="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
        </Row>

        <Row
          name="Code input"
          tag="input · 6 digits"
          why={
            <>
              Six boxes, one real input lying invisibly over them. Paste, OS
              autofill and the numeric keyboard are the platform's job - six
              separate inputs would mean re-implementing all three and getting
              focus management wrong. Non-digits are stripped, so a pasted “418
              206” works.
            </>
          }
        >
          <div style={{ width: 320, display: "grid", gap: 14 }}>
            <CodeInput value={code} onChange={setCode} />
            <CodeInput value="418206" onChange={() => undefined} wrong />
          </div>
        </Row>

        <Row
          name="Provider button"
          tag="action · social"
          why={
            <>
              A neutral badge, not the provider's logo - the kit already refuses
              brand colour for provenance, and a logo is someone else's asset
              with someone else's rules. Never the primary action: the emailed
              code is the path that depends on nobody.
            </>
          }
        >
          <div style={{ width: 320, display: "grid", gap: 9 }}>
            <ProviderButton provider="google" />
            <ProviderButton provider="microsoft" />
            <Rule />
          </div>
        </Row>
      </Section>

      <Section
        title="Screens"
        blurb="Whole screens composed only from the kit. If a screen needs something the components cannot express, that is a gap in the components - not licence to style it locally. These are the check that the two stay honest."
      >
        <Row
          name="Today"
          tag="screen"
          wide
          why={
            <>
              One timeline component repeated, and a rail of modules. Exactly
              one live slot and at most one ink module - enforced by whoever
              supplies the data, since a component cannot see its siblings.
            </>
          }
        >
          <TodayScreen
            date="Tuesday, 11 August"
            helper="Four slots proposed around three meetings"
            slots={TODAY_FIXTURE}
            gap="15 min free - held open"
          />
        </Row>

        <Row
          name="Placing a slot"
          tag="screen · free"
          wide
          why={
            <>
              The four steps a Free user goes through, on one screen because the
              steps are the argument: a scheduler hides all of this, and doing
              it by hand is what the Free plan <i>is</i>.
            </>
          }
        >
          <PlacingScreen />
        </Row>

        <Row
          name="Account"
          tag="screen · signed in"
          wide
          why={
            <>
              Three questions, three blocks: what we call you, how you get in,
              how you leave. The name field overrides whatever a provider told
              us. "Disconnect" removes a <i>sign-in method</i>, never a calendar
              - the note says so, because the two are separate grants and the
              wrong reading loses someone their sync.
            </>
          }
        >
          <AccountScreen
            email="mara@studio.com"
            name="Mara Kovac"
            draftName={draftName}
            onDraftNameChange={setDraftName}
            timeZone="Europe/Lisbon"
            timeZoneOptions={["Europe/Lisbon", "Asia/Dubai", "UTC"]}
            deviceTimeZone="Asia/Dubai"
            accounts={[
              { id: "a1", provider: "google", connectedAt: "3 August 2026" },
              {
                id: "a2",
                provider: "microsoft",
                connectedAt: "12 August 2026",
              },
            ]}
          />
        </Row>

        <Row
          name="Hours shown"
          tag="popover · day view"
          why={
            <>
              Which hours the timeline covers. The trigger sits with the date
              because it changes what is under it - the sync button on the far
              side of that line goes and fetches instead, which is a different
              class of act. Three ranges at most, and nothing configurable in
              here: the way out is a link to the settings that own them.
            </>
          }
        >
          <div style={{ height: 250 }}>
            <HoursMenu
              ranges={[
                {
                  key: "working",
                  label: "Working hours",
                  startMinutes: 8 * 60 + 30,
                  endMinutes: 17 * 60 + 30,
                },
                {
                  key: "full",
                  label: "Full day",
                  startMinutes: 0,
                  endMinutes: 1440,
                },
                {
                  key: "custom",
                  label: "Studio evenings",
                  startMinutes: 17 * 60,
                  endMinutes: 22 * 60,
                },
              ]}
              value={hours}
              onChange={setHours}
            />
          </div>
        </Row>

        <Row
          name="Outside the range"
          tag="line · day view"
          why={
            <>
              What the chosen range leaves out, kept visible. Dashed, the same
              as an empty row - both say "something belongs here and is not
              drawn". Hiding them outright is the failure this prevents: a day
              view that silently omits a meeting is worse than one showing too
              many.
            </>
          }
        >
          <OutsideRange
            edge="before"
            count={2}
            at="08:30"
            onExpand={() => undefined}
          />
          <OutsideRange
            edge="after"
            count={1}
            at="17:30"
            onExpand={() => undefined}
          />
        </Row>

        <Row
          name="Day view hours"
          tag="screen · settings"
          wide
          why={
            <>
              Where the ranges are configured. Working hours come first because
              they are not only a view - they are the window slots are placed
              in, so changing them changes the plan. Edits are a draft with
              Update and Cancel, the same as Calendars: hours are typed, and
              every keystroke reaching the server would be a write and a replan
              on its way to the value the user meant.
            </>
          }
        >
          <DayHoursSection
            // Showing an edit in flight: the working hours differ from what is
            // saved, so that block - and only that block - offers a commit.
            saved={{ ...dayHours, dayStartMinutes: 9 * 60 }}
            draft={dayHours}
            onChange={(patch) => setDayHours((d) => ({ ...d, ...patch }))}
            onCommit={(patch) => setDayHours((d) => ({ ...d, ...patch }))}
            saving={null}
          />
        </Row>

        <Row
          name="Sign in"
          tag="screen · signed out"
          wide
          why={
            <>
              One field and one action. The providers sit under a rule as
              alternatives, and the footnote carries the thing the buttons
              cannot say: signing in with Google is not connecting Google's
              calendar. Pass an empty <code>providers</code> and the rule and
              both buttons disappear - an environment with no credentials must
              not offer a door that cannot open.
            </>
          }
        >
          <SignInScreen email={email} onEmailChange={setEmail} chrome={false} />
        </Row>

        <Row
          name="Sign in · waiting on a provider"
          tag="screen · consent open elsewhere"
          wide
          why={
            <>
              Consent happens in a browser this window cannot see, so the screen
              has to say so - and always offer a way out, since the alternative
              is a state the user can only escape by quitting. The emailed code
              stays live throughout: waiting on Google is not a reason to lock
              the door that always works. Pass <code>consentUrl</code> when the
              browser could not be opened and the link is the way through.
            </>
          }
        >
          <SignInScreen
            email="mara@studio.com"
            waitingFor="google"
            consentUrl="https://accounts.google.com/o/oauth2/v2/auth?…"
            chrome={false}
          />
        </Row>

        <Row
          name="Check your email"
          tag="screen · waiting / wrong / expired"
          wide
          why={
            <>
              Three states of one screen, not three screens. A wrong code keeps
              its digits so they can be checked against the email and counts the
              attempts down; an expired one stops pretending the boxes matter
              and offers the two ways out.
            </>
          }
        >
          <div style={{ display: "grid", gap: 14 }}>
            <CheckEmailScreen
              email="mara@studio.com"
              code={code}
              onCodeChange={setCode}
              resendIn={24}
              chrome={false}
            />
            <CheckEmailScreen
              email="mara@studio.com"
              code="418206"
              wrong
              attemptsLeft={2}
              chrome={false}
            />
            <CheckEmailScreen
              email="mara@studio.com"
              code=""
              expired
              chrome={false}
            />
          </div>
        </Row>
      </Section>
    </div>
  );
};
