# Wise Routine launch: strategy, release controls, and acceptance

**Status:** Working document. It merges the former `launch-strategy.md` and `feature-releases.md`. Direction is a free basic launch, optional paid features later, and a discount for early users. Pricing, discount terms, and rollout thresholds below are recommendations requiring approval unless marked approved.

**Scope:** Part I is the commercial and product direction. Part II is how features are switched on and off. Part III is what is built, what is missing, and what must be manually accepted per milestone.

**The board is the tracker.** Open work for M0 and M1 lives in the [Wise Routine project](https://github.com/users/techswitch-uae/projects/1/views/1) as issues. Part III links to them instead of repeating checkboxes. M2–M6 keep checkboxes until they are ticketed.

**Approved decisions:** Free allowance is **3** active activity definitions (implemented, [#11](https://github.com/techswitch-uae/wiseroutine.ai/issues/11)). M0 ships **Google and Outlook** calendars (validation open, [#12](https://github.com/techswitch-uae/wiseroutine.ai/issues/12)). Domain is **wiseroutine.ai**.

**Related docs:** [addon launch](addon-launch.md), [capture and rescheduling](capture-and-rescheduling.md), [rearrangement](rearrangement.md), [release preparation](releasing.md), and the [project audit](project-audit.md). Statements about Free/Pro capabilities in the addon and capture docs describe those implementations, not this strategy. Release preparation and the audit remain separate technical launch gates. This document does not close any audit finding.

---

**Landing page implementation:** [`apps/web`](../apps/web/README.md) is the
TanStack Start marketing site for wiseroutine.ai. It reuses the app's UI and
scheduler for a labeled synthetic placement → meeting change → repair demo,
including the no-space case. **Primary CTAs create a Free account through the
existing app signup; the sample is secondary.** Installer readiness defaults to
preview, independently of signup: no unvalidated installers, checkout or
founding-discount claims. Confirm the signup deployment as well as platform/download
approval and live-provider acceptance before publishing. [Browser coverage](testing.md) distinguishes the
marketing suite from full-stack app tests and manual release gates.

# Part I — Strategy

## 1. Strategy in one page

### The promise

> Tell Wise Routine what you want to make time for. It finds room around your meetings—and adapts when your day changes.

Launch a small, complete experience, not a collection of partially exposed features. **Creating activities, automatic placement, and automatic rearrangement must ship together and be available on Free.**

### The business approach

1. Launch a useful free core, with no card required and no automatic conversion into a subscription.
2. Acquire broadly, but optimize for people who establish and repeatedly use a routine—not just account registrations.
3. Charge later for additional scope and control, never for the core promise or for reliability.
4. Give early users a founding discount once the paid tier exists.

### Recommended sequence

**Free core → free guided routines → free Quick Capture → Pro controls and larger routines → weekly planning → insights → community extensions.**

Target one meaningful announcement every two to three weeks after the core stabilizes. This is an operating cadence, not a public shipping commitment. Pause expansion when reliability, retention, or support capacity calls for it.

## 2. Initial audience and positioning

Start with people whose meeting-heavy workdays repeatedly push out focus time and personal routines: individual knowledge workers, freelancers, founders, and remote workers.

The concrete problem is:

> “I know what I want to do, but my calendar keeps changing and I don't want to rebuild my day.”

The product should be understood as an adaptive routine assistant, not initially as:

- A general project-management system.
- A replacement for Google Calendar or Outlook.
- A large habit-tracking dashboard.
- An addon marketplace.
- An AI assistant that understands everything about someone's work.

Lead with demonstrable scheduling behavior. Do not use “AI-powered” as a substitute for showing the value, or promise instant synchronization, background behavior, provider write-back, or offline capabilities beyond what has been validated.

## 3. M0: the minimum complete free product

### Included at launch

| Capability | Launch scope |
| --- | --- |
| Activity creation | Custom name, duration, and simple daily frequency. Keep all existing templates (Stretch, Eye rest, Walk, Deep work, Breathing, Water) as plain timed activities; guidance comes later. |
| Calendar connection | Read-only busy-time integration with Google and Outlook. Disclose the platforms each is validated on. |
| Availability | Working days, working hours, and timezone, with sensible scheduling defaults. |
| Automatic placement | Place activities into available gaps in the remaining day. The user should not have to manually assemble the routine. |
| Automatic adaptation | Repair affected activities when calendar changes create conflicts. Keep unaffected activities stable wherever possible. |
| Today view | Meetings, planned activities, and Up Next. Show a clear distinction between confirmed placement, suggestions, and unplaced work. |
| Follow-through | Start, complete, skip, move an occurrence, and use a plain timer. Activity definitions offer Edit and Remove. Optional reminders with recoverable permission settings. |
| Recovery and explanation | Explain moves, show work that could not fit, ask before unsuitable changes, and provide basic change-time controls. |
| Trust essentials | Clear sync/error states, privacy controls, account recovery, support, and account/data rights appropriate for launch. None are premium benefits. |

**Free allowance: three active activity definitions** (approved). This supports a small routine such as focus + walk + eye rest. A daily occurrence is not a separate activity definition; technical recurrence limits still apply. Inactive and archived records do not consume the active allowance. The code now enforces three ([#11](https://github.com/techswitch-uae/wiseroutine.ai/issues/11)); the activity UI offers Edit and Remove, not Pause/Resume. Disclose the allowance before launch; do not start with unlimited access and later shrink it without an explicit migration policy.

### First useful session

1. Choose or create one activity.
2. Confirm working hours.
3. Connect a calendar, or explore a clearly labeled sample day while connection is pending.
4. See the activity placed and understand why it fits.
5. Begin using the routine; ask for notification permission when it becomes useful.

Do not block the first useful plan on adding multiple activities, installing addons, accepting notifications, or completing a long setup checklist.

### The hero demonstration

Use a synthetic or explicitly consented calendar:

1. Ask for 45 minutes of focus and a 10-minute walk.
2. Show both finding room around meetings.
3. Change a meeting in the connected calendar.
4. Show the affected activity finding a new place while the rest stays stable.

If the video compresses sync time, disclose that rather than implying instantaneous changes. A sample-day preview is not evidence that a live provider connection works.

### Hidden at launch

- Week/month navigation and weekly planning tools.
- Full Quick Capture, Inbox, notes, links, and attachments.
- Specialized guided sessions beyond the plain timer.
- Advanced cadence, scheduling preferences, and ranked placement alternatives.
- Dashboard customization, secondary widgets, and deeper analysis.
- Addon discovery, installation, developer tooling, and community distribution.
- Checkout, upgrade prompts for unavailable products, and trial countdowns.

Keep the initial navigation approximately **Today · Activities · Settings**. Calendar configuration can be reached through setup and Settings.

**Do not hide the unplaced-activity recovery surface with Inbox.** Basic move, skip, and scheduling recovery remain part of the core. Keep addon architecture internally where useful; hiding the ecosystem does not require rewriting the application.

## 4. Free, Pro, and the founding-user offer

### Packaging rule

**Free proves and delivers the promise. Pro expands its scope and control.**

| Keep free | Recommended Pro value |
| --- | --- |
| A small active routine with automatic placement and basic adaptive rearrangement | A higher active-activity allowance; exact limit to be decided |
| Working hours, timezone, simple daily recurrence, and basic move/skip controls | Richer recurrence, preferred periods, configurable buffers, and ranked placement choices |
| Plain timer and the initial curated guided experiences | Future specialized services only where independently valuable; do not base Pro on hiding open addon source |
| Basic Quick Capture, Inbox, notes, links, and bounded attachments when released | Expanded storage only if demand and operating costs justify a separate, disclosed allowance later |
| Today and, later, a read-only week overview | Weekly targets and cross-day planning controls when fully implemented |
| Basic completion counts and access to the user's records | Longer-range trends, comparisons, and dashboard customization |
| Privacy, export/deletion access, reconnection, error recovery, security, and correctness | Never sell fixes to core reliability as premium features |
| Curated community access when safe to launch | Hosted premium capabilities remain entitled regardless of which client or addon invokes them |

Basic automatic adaptation is distinct from **ranked alternatives and advanced constraints**. The former is core and free; the latter can be Pro. Avoid using “smart scheduling” to describe only the paid tier.

If an additional calendar provider ships later for readiness reasons, treat that as an availability expansion, not automatically as a premium feature. Do not create artificial sync delays for free users that undermine the core promise.

### When to begin charging

The recommended first paid milestone is **M3: larger routines and advanced controls**, not the initial launch.

Before opening checkout:

- Users are returning to use the free routine, not only signing up.
- Users repeatedly request more activities or richer scheduling control.
- The first premium package works end to end and can be demonstrated honestly.
- Pricing is informed by calendar-sync, database, email, storage, and support costs.
- Checkout, account management, cancellation, discount application, renewal, and downgrade behavior have been validated.

M4–M6 do not need to exist before Pro launches. Conversely, do not enable checkout just because M3's suggested calendar date arrives.

### Founding-user offer — recommended terms, not yet approved

| Term | Recommendation |
| --- | --- |
| Eligibility | Verified accounts created before the first generally available paid release. No purchase or usage hurdle. |
| Benefit | 30% off the first 12 months of Pro. Avoid a lifetime discount initially. |
| Monthly billing | Discount for the first 12 months from paid activation. |
| Annual billing | Discount on the first annual term; subsequent renewal at the then-applicable regular price. |
| Redemption | A 90-day activation window starting at Pro general availability, with the exact deadline clearly communicated. |
| Application | Applied automatically at checkout for eligible signed-in accounts; no coupon hunting. |
| Conversion | Explicit opt-in only. No card required for Free and no automatic paid enrollment. |
| Disclosure | Show discount duration, actual payable amount, renewal terms, taxes as applicable, and deadline before purchase. |

Confirm billing-provider semantics, cancellation/restart treatment, stacking, and eligible plans before publishing these terms. Do not promise a percentage publicly until it is approved and implementable. Record which offer version each account qualified for; honor published terms rather than silently changing them.

Store founding eligibility separately from both subscription entitlements and beta grants ([#19](https://github.com/techswitch-uae/wiseroutine.ai/issues/19)). An early free user is not an expiring Pro subscriber. Ensure legitimate prelaunch users are considered when eligibility is backfilled, and existing grants or purchases are not silently overwritten.

A general statement that early users will receive a discount can precede finalized pricing. Before publishing that statement, still define and record who qualifies. Reserve “30% for 12 months” copy for the approved offer.

### Downgrade principles

Never delete activities, captures, or history because a subscription ends. Let users choose which activities remain active within the free allowance. Specify how premium recurrence/preferences fall back or pause before selling them; do not silently reinterpret a complex routine into a different schedule. Keep access to records and free-tier recovery controls.

## 5. Ordered release roadmap

This is a product release order, not an assertion that every item already exists or is ready. Readiness is assessed per milestone in Part III.

| Order | Milestone and outcome | Free release | Paid release | Why here / readiness dependency |
| --- | --- | --- | --- | --- |
| M0 | **A routine that adapts** | Activity creation, calendar-aware auto-placement, stable adaptation, Today, basic control/timer/reminders | None | Establish the defining value and a trustworthy recurring-use loop. |
| M1 | **Make the time count** | Curated focus, breathing, eye-rest, and stretching sessions, introduced as one guided-routines release | None initially | Improve follow-through without a second workflow. Validate packaged sessions and safe plain-timer fallback. |
| M2 | **Give new work a place** | Quick Capture + Inbox, existing-item scheduling, postponement, notes and links; bounded files as a smaller follow-up | None initially | Add everyday usefulness after the routine is understood. Keep routine recovery independent of Inbox. |
| M3 | **Your routine, your rules** — first Pro release | Preserve all launched core features; ship any associated usability fixes to everyone | Larger active routines, richer cadence/preferences/buffers, ranked placement alternatives | Charge for repeatedly requested depth. Each advertised rule must survive create, plan, calendar change, restart, and downgrade. |
| M4 | **Make room across the week** | Read-only week overview | Weekly targets and cross-day planning/control | Requires trustworthy date/timezone handling and explicit semantics for weekly demand. A week grid alone is not weekly optimization. |
| M5 | **See what you made time for** | Simple day/week completion recap; optional privacy-safe sharing if built | Longer-range trends, planned-versus-completed analysis, dashboard customization | Requires trustworthy completion history. Never equate scheduled minutes with completed minutes or claim productivity gains without evidence. |
| M6 | **Make it yours** | Reviewed community routines/addons and, separately, public developer tools after their own launch gates | Existing hosted Pro entitlements still apply; no paid-addon marketplace in this phase | Launch only with review, distribution, permission, revocation, and support processes validated. |

### Small releases between milestones

- Individual guided routines can sustain smaller posts after M1; do not manufacture a major launch for every exercise.
- M2a can introduce text capture + Inbox; M2b can expose notes/links and M2c files once their separate acceptance checks pass. Preserve the existing technical attachment limits initially, rather than inventing a storage paywall.
- Month view, density controls, and small UI improvements can ship quietly when useful. Not every toggle deserves a campaign.
- A third validated calendar provider or native platform can be a meaningful reach announcement whenever ready; it does not need to wait for the premium roadmap.
- Shareable routine templates are a promising later acquisition experiment, but are **new work**, not a capability assumed to exist because addons do. Default sharing must omit calendar details and personal content.

## 6. What to communicate at each milestone

All copy below is a draft. Use launch wording only after the feature is available to the stated audience. Replace placeholders, confirm terms, and verify claims before publication. Clearly label previews and limited cohorts.

### Before M0 — recruit around the problem

**Message:** The day changes; maintaining a routine should not require manually rebuilding it.

**Post:**

> What keeps getting pushed out of your workday: focus time, a walk, or a proper break? We're building Wise Routine to find room around your meetings and adapt when plans change. The basic version will be free, with optional paid features later. Join the launch list: [link].

**CTA:** Join the launch list and name one activity that gets displaced.

**Execution:** Share short, labeled prototype demos. Recruit a small design-partner cohort before broad distribution ([#27](https://github.com/techswitch-uae/wiseroutine.ai/issues/27)). A mailing-list signup is not founding-account eligibility unless that is explicitly added to the approved offer.

### M0 — launch the complete free core

**Headline:** A smarter routine. Less rearranging your day.

**Post:**

> Wise Routine is here. Choose what you want to make time for, let it find room around your meetings, and watch your routine adapt when plans change. The basic version is free, with no credit card required. Optional paid features are coming later, and early users will receive a founding-user discount. Works with Google Calendar and Outlook on [validated platforms]. Try it: [link].

**Signup/FAQ reassurance:**

> This is a free basic version, not an expiring trial. We plan to offer optional paid features for larger routines and more control. You won't be charged unless you choose to upgrade.

**CTA:** Create your first activity.

**Execution:** Publish the placement → meeting change → repair demo ([#26](https://github.com/techswitch-uae/wiseroutine.ai/issues/26)). Use one canonical landing page ([#4](https://github.com/techswitch-uae/wiseroutine.ai/issues/4)), relevant communities that permit launches, and personal outreach. Show limits and actual platform availability before download. Ask early users which placement felt helpful or wrong.

### M1 — guided routines, not more configuration

**Headline:** We make room. Now we help you use it.

**Post:**

> New in Wise Routine: guided focus and break sessions. When your activity comes up, start the session instead of deciding what to do next. The initial guided routines are included free. Try one in your next available gap: [link].

**In-app:** “Guided routines are here · Included in Free · Try a session.”

**Engagement:** Invite users to try one routine for five days and report what helped. Avoid guilt-based streak messaging or medical/health-effect claims. Do not require social sharing to keep access.

### M2 — useful when new work appears

**Headline:** Something new came up? Give it a place.

**Post:**

> Quick Capture and Inbox are now in Wise Routine. Capture a task, keep it for later, or choose an available time without rebuilding your day. Included free. Try it with the next small task that interrupts you: [link].

**Demo:** Capture → available time → confirmation, followed by an Inbox example. Show only the input types released in that submilestone. Do not imply that basic manual capture is an autonomous deadline optimizer.

**In-app:** “Capture something new · ⌘K on macOS / Ctrl+K on Windows.” Only show platform shortcuts actually supported.

**Engagement:** Ask what people capture and what they postpone. Use responses to prioritize richer task capabilities, not to turn Inbox into a project-management system by default.

### M3 — introduce Pro without taking Free away

**Headline:** More room for your routine. More control over your day.

**Post:**

> Wise Routine Pro is here for larger routines and more scheduling control: [only the capabilities shipping today]. The free version still includes automatic placement and adaptive rearrangement for a small routine. Upgrade if you need the extra depth; keep using Free if you don't. Compare plans: [link].

**Founding-user email, only after offer approval:**

> You helped shape Wise Routine early. As a founding user, you can get 30% off your first 12 months of Pro when you upgrade by [date]. Your offer is applied automatically at checkout. After the discounted period, the regular price applies; you'll see the amount and renewal terms before purchase. Nothing changes if you stay on Free. See your offer: [link].

**Execution:** Announce to early users before the general audience. Publish a plain Free/Pro comparison, working billing-management links, and the exact offer terms. Show actual prices; do not use “starting at” to obscure the billing period or amount charged.

**CTA:** Compare plans / View your founding offer. Prompt upgrades when a user requests a premium capability—not every time they open Today. Do not advertise unshipped M4/M5 features as included current value.

### M4 — weekly visibility, with optional planning depth

**Headline:** Does your week have room for what matters?

**Post:**

> The week view is here, free for everyone. See your meetings and routine in one place. Pro adds [validated weekly targets and planning controls] when you want to shape more than today's schedule. Take a look at your week: [link].

**Engagement:** Introduce a Monday check-in: “What's one thing you want to make room for this week?” Use synthetic or redacted screenshots.

**CTA:** Open your week; show Pro detail only where the paid controls begin. If only the overview is ready, announce only that and keep weekly planning in preview.

### M5 — reflect on completed activity, not theoretical productivity

**Headline:** See what you actually made time for.

**Post:**

> Your Wise Routine recap now shows the activities you completed and the time you recorded. The basic recap is free; Pro adds longer-range trends and a customizable dashboard. See your recap: [link].

**Engagement:** Invite reflection on a useful change, not competition over minutes. If sharing is implemented, make it opt-in with a preview, and omit meeting titles, task text, and sensitive activity details by default.

**Avoid:** “We saved you X hours,” “you were X% more productive,” or “your routine improved your health” unless there is evidence supporting that exact claim.

### M6 — user customization first, developer ecosystem second

**Headline:** Make Wise Routine work your way.

**Customer post:**

> Explore a small, reviewed collection of community routines and addons for Wise Routine. Choose what fits your day and review the permissions before enabling it. Browse the collection: [link].

**Separate developer post, only after actual publication:**

> Build guided routines and widgets with the Wise Routine addon toolkit. The SDK and authoring tools are open source; the Wise Routine app and hosted service are separate. Community distribution starts with reviewed submissions. Start building: [public kit link].

**Engagement:** Feature real creators with permission, explain what their addon does, and invite focused requests. Do not announce an open marketplace, guaranteed safety, unrestricted integrations, or developer earnings.

### Communications rhythm for each release

- **Before preview:** One problem-focused teaser and an opt-in tester invitation.
- **During preview:** Direct feedback, labeled demos, and readiness work—not a false general-availability announcement.
- **At general availability:** One short demo, a launch post, release notes, a targeted email where permitted, and a dismissible in-app announcement with the Free/Pro label.
- **After launch:** One practical example or consented user story, a feedback question, and a review of usage and support issues.

Maintain a public changelog ([#9](https://github.com/techswitch-uae/wiseroutine.ai/issues/9)) and a restrained “Now / Next / Exploring” roadmap. Do not publish speculative deadlines. Avoid repeatedly emailing inactive users or conditioning access on marketing consent; honor communication preferences and unsubscribe requirements.

## 7. Measure growth, value, trust, and cost

### Initial funnel

**Account created → first real activity auto-placed → first completion → routine used on subsequent days.** Instrumentation is [#20](https://github.com/techswitch-uae/wiseroutine.ai/issues/20).

A sample-day interaction is an interest signal, not real activation. Separate signups, calendar-connected users, activated users, and retained users in reporting.

| Question | Suggested measurement |
| --- | --- |
| Are people reaching the value? | First real placement rate and time from signup to usable plan; record sample and live-calendar paths separately. |
| Are routines useful? | First completion, active days, and return during the following week among activated cohorts. Define the cohort/window consistently. |
| Is adaptation trusted? | Automatic repair frequency, immediately corrected/rejected moves, and recurring reasons for rejection. Lack of correction alone is not proof of satisfaction. |
| Is scheduling dependable? | Conflicts, missing/unplaced activity reports, sync failures, stale plans, reconnect frequency, and recovery time. |
| Are later features worth shipping? | Adoption among eligible users, repeat use, user feedback, and effect on core use—not announcement clicks alone. |
| Is Pro justified? | Repeated demand for premium capabilities, limit encounters, opted-in paid-preview interest, and later paid conversion/retention. |
| Is Free sustainable? | Cost per active user, provider/API load, per-user storage, queue lag, and support burden. |

Instrument intent and outcomes without collecting calendar titles, task contents, attachment names, or private notes in analytics. Do not label a programmatic/automatic status transition as a user-confirmed completion. Explain analytics practices and honor applicable privacy choices.

Set numerical promotion and rollback thresholds from the initial cohort baseline **before** each rollout. There is no universal retention percentage that proves launch readiness. Combine metrics with interviews and observed sessions when the cohort is small.

Spend first on reducing friction and demonstrating the product. Defer scaled paid acquisition until activated users are returning and onboarding is dependable. Sustainable growth matters more than an impressive one-day signup count.

## 8. Decisions and approvals

### Settled

- Free core boundary: automatic placement and basic adaptive rearrangement included.
- Free active-activity allowance: three.
- M0 calendar providers: Google and Outlook.
- Domain: wiseroutine.ai.

### Still to approve

- [ ] Launch platforms, and the actual synchronization/background guarantees per platform ([#18](https://github.com/techswitch-uae/wiseroutine.ai/issues/18)).
- [ ] Founding eligibility definition and exact discount terms. Recommendation: 30% for 12 months, redeem within 90 days of Pro general availability.
- [ ] A sustainable operating budget, and which technical limits to disclose.
- [ ] Owners for product decisions, release operations/rollback, support/incidents, and communications ([#10](https://github.com/techswitch-uae/wiseroutine.ai/issues/10)).

### Before each subsequent milestone

- [ ] Confirm the roadmap order still matches user needs; document any change without retracting published promises.
- [ ] Approve the exact Free/Pro slice, availability flags, acceptance tests, migration and rollback behavior.
- [ ] Set rollout criteria, minimum supported version, owner, and support capacity.
- [ ] Run the preview → staged rollout → general availability → follow-up process.
- [ ] Publish copy that describes only what the announced audience can actually use.

### Before the first paid release

- [ ] Finalize Pro's price, active-activity allowance, and the capabilities ready now.
- [ ] Complete billing/legal/support flows and test the approved founding offer end to end.
- [ ] Notify eligible early users, publish exact terms, and make the offer automatic at checkout.
- [ ] Verify that staying on Free preserves the launched basic scheduling value.

---

# Part II — Release controls

**Default public experience: M0 only. Every post-launch flag defaults to `false`.** No production flags or infrastructure were changed by the implementation pass. Existing installations must update both the API and desktop to obtain the new gates; older desktop builds cannot be made to hide navigation they already contain.

## 9. Separate four different decisions

1. **Release availability:** Is this feature ready for this account/cohort and client version?
2. **Entitlement:** Does the account's Free/Pro plan include it?
3. **Preference:** Has the user enabled it, where an opt-in is appropriate?
4. **Founding-discount eligibility:** A separate commercial record.

A release flag must not masquerade as a subscription. Beta access, if offered, is explicitly labeled with its own terms and does not silently become a charge.

## 10. What the core app exposes today

- **Today · Activities · Settings.** Calendar connection/selection remains core, reachable from setup and the **Calendars section within Settings**. Old `/calendars` bookmarks redirect to `/settings#calendars`, keeping Settings selected.
- The **entire existing activity library**: **Stretch, Eye rest, Walk, Deep work, Breathing, and Water**, plus custom activities. These are ordinary timed activities, not guided sessions. The library itself is not behind a flag.
- Duration, daily count, activity days, working hours, and timezone. Today offers **Working hours** and **Full day (00:00–24:00)** in core; the last selected view is remembered per account in local storage across navigation and app restarts, without changing scheduling hours. Custom ranges and density remain gated. Explicitly changing “Day opens on” in Settings clears this device's last-view override.
- Automatic placement and calendar-change adaptation on **Free**, not an expiring trial.
- Starting, completing, skipping, dragging/changing an occurrence's time, editing/removing activity definitions, and inspecting meetings. A started slot cannot be postponed. **Stop** is available only before half its duration or two minutes from the actual Start, whichever is shorter (and never beyond the slot's end). Stopping early unlocks Postpone; after the cutoff the user can create another slot instead. The widget updates at the cutoff and the API enforces the same rule.
- Up Next, missed/unplaced work, and basic recovery. Turning off Inbox does **not** turn off routine recovery. A useful guidance card fills an otherwise empty rail and disappears when any other widget has content.
- Sync/reconnection, privacy controls, account settings, native notifications/tray, and updates.

Adding a new activity places its demand into the remaining day without deleting/repositioning accepted placements. Activity controls are Edit and Remove. Legacy inactive records and internal addon deactivation remain supported without exposing Pause/Resume controls. Opening Today and explicit replanning do not place new work in elapsed working hours.

**The default Free/core limit is three active activities**, enforced by both the API and UI ([#11](https://github.com/techswitch-uae/wiseroutine.ai/issues/11)). When `larger_routines` is off, new activation/creation uses the core allowance even for a preview account with a Pro grant; existing records and subscriptions are not deleted or rewritten.

New signups no longer receive automatic 14-day Pro grants. Existing grants/subscriptions still resolve normally. Founding-user discount eligibility, pricing, and redemption are **not implemented** by these flags.

### What stays hidden with all flags off

Inbox, Quick Add and its shortcut, attachments, guided sessions/configuration, addon discovery/management, specialized addon execution, advanced activity preferences, week/month/year navigation, future-day browsing, custom day-view ranges/density controls, progress/insight widgets, dashboard customization, trial badges, and checkout availability.

The development design/simulator routes (`/design`, `/design-sessions`, `/sim`) refuse navigation in production builds independently of customer flags. There is no year route to enable.

## 11. Switch features on and off

Use the operator CLI from the repository root. It uses the existing Wrangler `CONFIG` KV binding and your Cloudflare credentials for remote environments. There is **no public administrative endpoint, browser override, or localStorage unlock**.

```sh
# Inspect the current local configuration (does not enable anything).
pnpm features show --env local

# Work on guided sessions. All existing templates are available even before this.
pnpm features enable m1 --env local
pnpm features disable m1 --env local

# Work on just text/link capture + Inbox, without file uploads.
pnpm features enable quick_capture --env local
# Or enable the entire capture milestone, including files.
pnpm features enable m2 --env local

# Return the local environment's defaults to core only.
pnpm features disable all --env local

# Give only your account a preview on the deployed dev API.
pnpm features enable m3 --env dev --user USER_ID
pnpm features show --env dev --user USER_ID
pnpm features disable m3 --env dev --user USER_ID

# Remove personal overrides and inherit that environment's defaults again.
pnpm features reset --env dev --user USER_ID

# Inspect a potential production change without writing.
pnpm features enable guided_sessions --env production --dry-run
# After acceptance, an intentional production write needs an extra confirmation.
pnpm features enable guided_sessions --env production --confirm-production
```

Available environments: **`local`**, **`dev`**, **`production`**. A missing `--env` means local. Misspelled options/environments and unknown flags are rejected. Use the account's **ID**, not email; it is `user.id` in the authenticated `/auth/get-session` response. Never copy its session token into documentation or commits.

`pnpm api` and `--env local` use `apps/api/.wrangler` state. Browser tests use a separate `.wrangler/e2e-state` store and never change your local development flags. If you run Wrangler with a custom persistence directory, adapt the CLI/run configuration to that same directory before expecting the settings to match.

### Resolution and operating rules

- Registry/defaults: [`packages/plans/src/features.ts`](../packages/plans/src/features.ts).
- Global JSON overrides: KV key **`release-features:v1`**.
- Account JSON overrides: **`release-features:v1:user:USER_ID`**.
- Values are known flag names mapped to literal JSON booleans. Unknown keys, strings such as `"true"`, corrupt JSON, or unavailable configuration fail closed to the core-only snapshot.
- Account overrides win over global defaults, including explicit `false`. **`disable all` without `--user` changes global defaults; it does not erase personal previews.** Disable/reset relevant account overrides as well when ending a preview. There is not yet a separate instantaneous environment-wide emergency kill switch or override inventory UI.
- `enable` expands a feature's required flags. It does **not** enable all previous milestones, grant Pro, publish addon packages, configure Stripe, or finish missing features.
- `disable` leaves dependent flags' requested settings intact, but they resolve off while their prerequisites are off. Re-enabling the prerequisite can restore them. `show` prints both requested and effective values.
- `reset` deletes the selected scope's overrides. On an account, this means **inherit global settings**, not necessarily core-only. Use `disable all --user USER_ID` to explicitly keep an account on core.
- Changes reach the running app on navigation, focus/online recovery, or its **30-second refresh**. KV has its own eventual-consistency/cache delay; this is not an instantaneous security revocation guarantee. Refresh the app and inspect effective flags to confirm a rollout.
- During a transient offline error, an already verified client snapshot has a **five-minute, memory-only lease**, checked on refresh. Failed refreshes do not renew it. This lets an open capture report its offline error and retain its draft instead of disappearing immediately. Explicit server-off or malformed responses still clear access; restart/account changes start core-only. Suspended webviews do not provide an exact wall-clock hide deadline, and server authorization remains authoritative.
- Runtime flags are not build-time code removal. Disabled code may still be bundled; sensitive operations remain authenticated and server-gated.
- CLI changes are read/modify/write, not an atomic multi-operator transaction. Use a single release operator, record the change in release notes, and avoid concurrent edits. Audited administration, percentage rollout, version-targeted rollout, and operator history are future work.

### Release availability is not billing entitlement

Enabling M3 does not turn a Free account into Pro. Larger routines and advanced preference writes still use plan checks. Use an existing authorized Pro test account/grant when testing those paths. This CLI deliberately has no plan-grant command.

Do not publicly enable `billing_checkout` until the commercial flows are complete. It combines with the existing `PRO_OFFER_ENABLED` sales switch; that switch alone can no longer expose checkout. Subscription reads, webhooks, and an existing customer's portal remain available for account recovery even when new checkout is off.

## 12. Flag inventory

All initial public values below are **off**. A milestone selector enables the flags assigned to that milestone plus prerequisites; it is a convenience group, not a separate entitlement.

| Flag | Milestone | Requires | Controls |
| --- | --- | --- | --- |
| `guided_sessions` | M1 | — | Guided activity configuration, module lookup, bundled guided-session loading, overlay and automatic start behavior. Not the activity templates themselves. |
| `inbox` | M2 | — | Inbox navigation/direct route, todo list/details/status APIs, and return-to-Inbox actions. |
| `quick_capture` | M2 | `inbox` | Palette, sidebar action, ⌘/Ctrl K/custom launch event, capture API, todo placement, and bundled todo addon. Notes/links ship with this slice. |
| `capture_files` | M2 | `quick_capture` | New file inputs/drop/paste/upload/claim actions. Existing downloads and deletion remain authorized recovery paths. |
| `advanced_scheduling` | M3 | — | New/changed advanced cadence, preference anchors, importance, grace and buffer settings; current landing preference UI for Pro. Ranked alternatives remain unfinished. |
| `larger_routines` | M3 | — | Pro's higher active-activity allowance. Does not grant Pro. |
| `billing_checkout` | M3 | — | Checkout availability and commercial/trial presentation. It does not reinstate automatic signup trials. |
| `day_view_options` | M4 | — | Future-day browsing, custom range/density UI, advanced view settings and non-current-day reads. Core working hours/timezone and the Working hours / Full day view switch remain. |
| `week_view` | M4 | `day_view_options` | Week route/navigation and multi-day scope reads. |
| `month_view` | M4 | `week_view` | Month route/navigation and scope reads beyond seven days. |
| `weekly_planning` | M4 | `advanced_scheduling`, `week_view` | Existing future-day planning/materialization and weekly-minimum inputs. Not a complete cross-day optimizer or finalized premium package. |
| `insights` | M5 | — | Today-so-far/progress presentation and the bundled day-so-far addon. |
| `dashboard_customization` | M5 | `insights` | Future/customizable widget availability; editor and persistence integration are still missing. |
| `community_addons` | M6 | — | Addons route/navigation, catalog/install/change/remove/bundle APIs, and non-bundled addon execution. Does not bypass M1/M2/M5 gates on first-party bundles. |

Examples of independent slices:

- `enable m1`: guided sessions, without Inbox, dashboards, or the addon-management page.
- `enable quick_capture`: Inbox + capture, without new attachments or week navigation. The single-day scope read needed to offer tomorrow's gap is allowed without exposing the week view.
- `enable week_view`: day-view options + read-only week surface, without weekly planning or advanced activity controls.
- `enable community_addons`: the ecosystem, but not automatic activation of every bundled addon. Turn on the milestone behind a bundled addon separately.

## 13. Rollout procedure

1. **Define the slice.** Write down the user problem, exact included behavior, Free/Pro boundary, dependencies, supported versions, acceptance tests, success signals, and rollback behavior.
2. **Prepare dark.** Keep public defaults off; enable only the milestone/slice being worked on locally or for your own dev account. Deploy backward-compatible storage/API support with new public entry points off. Flags do not replace migrations, authorization, or client-version compatibility.
3. **Finish the slice.** Read its Part III section, complete the missing behavior, and add regressions to the relevant suites.
4. **Test internally.** Exercise supported platforms, real integrations, permissions, direct URLs/API calls, account switching, offline/reconnect behavior, and the flag-off path. Test paid entitlement separately where applicable.
5. **Record manual acceptance** on the real supported platforms/providers. Record build/API versions, tester, date, issues, and decision on the milestone's board issue.
6. **Invite an early-access cohort.** Use stable account-level assignment so a user's feature does not flicker between requests or devices. Percentage rollout is not implemented; account overrides are the current mechanism. Identify the release as a preview and provide a feedback channel.
7. **Review evidence.** Compare activation, errors, scheduling corrections, support reports, and operating costs with the previous release. Fix material issues before expanding.
8. **Expand gradually,** for example internal → invited testers → all eligible accounts. For a small user base, hand-selected cohorts and direct feedback beat false statistical precision.
9. **Announce general availability** only after the intended accounts can use the accepted feature. Earlier posts must say “preview” or “rolling out,” and billing/plan copy must match actual access.
10. **Follow up and stabilize.** Publish an example or user story with consent, review the first complete usage cycle, remove obsolete rollout branches and temporary overrides, and keep a documented rollback path.

A developer test account with all features enabled is not evidence that the intended Free, Pro, founding-user, and flag-off combinations work.

## 14. Enforcement, rollback, and legacy data

### Enforcement

- Enforce release availability and entitlements on the server wherever behavior or data access requires it. UI hiding alone is not a gate.
- Cover navigation, keyboard shortcuts, deep links, APIs, scheduled jobs, tray actions, widgets, and addon-originated calls. Installing an addon must not bypass hosted feature restrictions.
- Gate new background behavior consistently. Turning off a feature must not strand in-flight operations, linked records, or required core scheduling work.
- Give each flag an owner, dependency list, last-change audit record, and removal/review condition. Avoid permanent unexplained flag combinations.
- Use safe defaults on configuration failure: keep the established core working, and fail closed for unreleased or unauthorized capabilities.
- Operational emergency controls must not silently turn a free smart routine into manual-only scheduling; show an honest degraded state and recovery guidance during an incident.

### Rollback and legacy-data boundaries

These flags are release gates, not destructive migrations:

- Existing activity definitions, captures, files, schedules, grants and subscriptions are retained.
- Basic edits omit hidden advanced/session fields. Stored advanced preferences remain honored for existing definitions; a rollback does not silently rewrite someone's routine. This is deliberate grandfathering of data, not permission to create new advanced settings while off.
- Already scheduled captured/addon work remains visible as ordinary slots with core start/complete/skip/change-time controls. It must not disappear from the day because its creation workflow is hidden.
- Guided frames fall back to plain slots. New automatic guided starts stop when the flag is off; auto-started sessions already underway can be cleaned up. A newly user-started plain session is not marked complete by an old hidden auto policy.
- Safe file download/deletion APIs remain authenticated even when new uploads/capture are disabled. Turning off the entire Inbox hides its details UI; re-enable a recovery cohort or use support-assisted authorized access when needed. Do not describe a full self-service recovery/export UI as already built.
- A malformed/unavailable server configuration returns core-only. For transient client offline errors, a previously verified snapshot can remain visible within its five-minute in-memory lease; it never grants new access and failed refreshes never renew it. Expiry, restart, or account change returns to core-only. Drafts retain existing autosave guarantees, not a new guarantee against process termination before autosave.
- Define how existing sessions and previously created premium schedules behave when flags or entitlements change. Avoid surprise activity deletion or whole-day reshuffles.

---

# Part III — Milestone status and acceptance

**Status vocabulary:** “Built” means code exists and is reachable behind the appropriate flag. It does not mean validated with live accounts or signed installers. M0 and M1 open work is on the [board](https://github.com/users/techswitch-uae/projects/1/views/1); M2–M6 keep checkboxes until ticketed. No item is closed merely because a unit suite is green.

## M0 — core launch (no release flag)

**Built:** Shared default-off registry, server resolution, per-account previews, operator CLI, client refresh/reset, direct-route guards, endpoint gates, and addon unload/authorization filtering. Simplified shell; full activity template library preserved as timed activities; advanced/session fields omitted rather than erased on basic edits. Free automatic planning/repair, remaining-day placement, automatic placement on activity creation, accepted-slot preservation, and Edit/Remove activity controls. Calendars are configured inline in Settings; privacy has a clearly explained Save meeting details toggle. Turning it off removes saved details and stops saving new ones while preserving busy times. The Free/core allowance is three. No automatic signup trial, unavailable checkout blocked, no hidden-Pro upsell in core activity-limit/recovery copy. First-activity onboarding target reduced from two to one; notification permission no longer blocks setup completion.

**Open work**

| Issue | Item |
| --- | --- |
| [#11](https://github.com/techswitch-uae/wiseroutine.ai/issues/11) | **Implemented:** Free/core allows three; a fourth is refused and removal frees a place |
| [#12](https://github.com/techswitch-uae/wiseroutine.ai/issues/12) | Validate Google and Outlook calendar connections |
| [#13](https://github.com/techswitch-uae/wiseroutine.ai/issues/13) | **Implemented and regression-tested:** verified OAuth proof and atomic session claim. Apply directory migration `0006_social_handoffs.sql`; live provider/native acceptance remains |
| [#14](https://github.com/techswitch-uae/wiseroutine.ai/issues/14) | Resolve remaining audit findings: timezone/date/cache races, settings commits, error states, accessibility |
| [#15](https://github.com/techswitch-uae/wiseroutine.ai/issues/15) | Finish sample-day onboarding and working-hours confirmation |
| [#16](https://github.com/techswitch-uae/wiseroutine.ai/issues/16) | Privacy, export, deletion, support, and recoverable notification settings |
| [#17](https://github.com/techswitch-uae/wiseroutine.ai/issues/17) | Validate signed installers, updates, and production config/migrations/tenant routing |
| [#18](https://github.com/techswitch-uae/wiseroutine.ai/issues/18) | Decide and validate hidden, suspended, and offline behavior |
| [#19](https://github.com/techswitch-uae/wiseroutine.ai/issues/19) | Founding-user eligibility tracking |
| [#20](https://github.com/techswitch-uae/wiseroutine.ai/issues/20) | Instrument the core funnel |

**Manual acceptance**

| Issue | Item |
| --- | --- |
| [#21](https://github.com/techswitch-uae/wiseroutine.ai/issues/21) | Fresh account, account with all addons installed, expired grant, and active subscription each open with core entry points only |
| [#22](https://github.com/techswitch-uae/wiseroutine.ai/issues/22) | All six templates and a custom activity create and start as plain timed blocks, with no guided frame/settings/download |
| [#23](https://github.com/techswitch-uae/wiseroutine.ai/issues/23) | First activity places, second preserves accepted slots, real meeting changes repair, no-space work stays visible and actionable |
| [#24](https://github.com/techswitch-uae/wiseroutine.ai/issues/24) | Edit/remove activities and skip/move/complete sessions across reload, account switch, network failure, and native suspend/resume, with no Inbox dependency |
| [#25](https://github.com/techswitch-uae/wiseroutine.ai/issues/25) | At 800×650 and 200% zoom, a keyboard user can create an activity and complete a session |

**Launch:** hero demo [#26](https://github.com/techswitch-uae/wiseroutine.ai/issues/26), design-partner cohort [#27](https://github.com/techswitch-uae/wiseroutine.ai/issues/27), launch post/FAQ/release notes [#28](https://github.com/techswitch-uae/wiseroutine.ai/issues/28). Business setup: [#2](https://github.com/techswitch-uae/wiseroutine.ai/issues/2)–[#10](https://github.com/techswitch-uae/wiseroutine.ai/issues/10).

## M1 — guided routines

Enable: `pnpm features enable m1 --env local`

**Built:** Four bundled addons (`addons/breathing`, `eye-rest`, `stretch`, `deep-work`), activity-module settings, session chrome/timers, module defaults, sandboxed frames and permissions. The installed-addon loader seeds/loads only released first-party bundles. Plain fallback remains available. The grace worker does not auto-start guided policies while M1 is off; automatic sessions already in flight can finish cleanup without auto-completing newly user-started plain sessions.

**Open work and acceptance**

| Issue | Item |
| --- | --- |
| [#29](https://github.com/techswitch-uae/wiseroutine.ai/issues/29) | Opt-in path to add guidance to activities created as plain blocks — no inference from names, no silent conversion |
| [#30](https://github.com/techswitch-uae/wiseroutine.ai/issues/30) | Guided configuration UX without the M6 addon page; version mismatch and recovery messaging |
| [#31](https://github.com/techswitch-uae/wiseroutine.ai/issues/31) | Activity library grouping and custom-entry discoverability with guided groups enabled |
| [#32](https://github.com/techswitch-uae/wiseroutine.ai/issues/32) | Packaged macOS/Windows acceptance of each routine, sound, notification permission, timer, suspend/resume; plus manual/prompt/auto policy, completion, skip, restart, postponement |
| [#33](https://github.com/techswitch-uae/wiseroutine.ai/issues/33) | Flag off mid-session: guidance stops, core lifecycle controls and saved settings/history survive; re-enable, reconnect and switch accounts with no stale frames or carried-over permissions |
| [#34](https://github.com/techswitch-uae/wiseroutine.ai/issues/34) | Staged rollout of `guided_sessions` with stable per-account assignment |
| [#35](https://github.com/techswitch-uae/wiseroutine.ai/issues/35) | M1 announcement |

## M2 — Quick Capture, Inbox, then files

Enable text/links: `pnpm features enable quick_capture --env local`
Enable attachments later: `pnpm features enable capture_files --env local`

**Built:** Core-owned capture, text/links/notes, atomic and idempotent todo + placement, existing-item scheduling, Inbox search/pagination, rich details, rescheduling and history preservation, retained local drafts, bounded private files and native export helpers. See [capture and rescheduling](capture-and-rescheduling.md) for the data model and limits. Drafts with files are retained when uploads are off; they are not silently stripped from a save. Existing file downloads/deletion stay authorized during rollback.

**Missing / unfinished:**

- [ ] Native acceptance for file choose/drop/paste, Save dialog cancellation/overwrite/error, Windows behavior, and interrupted requests.
- [ ] Production latency/storage/backup cost validation. Current files live in bounded database chunks, not a new large-file object-storage system.
- [ ] Broader accessibility and account-switch/restart acceptance of every capture/detail state.
- [ ] Product decisions about task depth and any future expanded-storage allowance. No new file paywall is implemented.

**Manual acceptance, in slices:**

- [ ] Text + link capture: shortcut, double Enter, save to Inbox, schedule an existing item, occupied/no-space cases, and retry without duplicates.
- [ ] Inbox: search, pagination, completion/drop, plan/postpone, day-crossing and DST behavior; confirm routine recovery still works with Inbox off.
- [ ] Files: exact downloaded bytes, all quota boundaries, removed/retained drafts, failure/retry, native chooser/export, and logout/account isolation.
- [ ] Disable just `capture_files`: no upload affordance, direct uploads/claims refused, existing authorized downloads still work.
- [ ] Disable capture while work exists: do not delete records; retain core scheduled-slot lifecycle and reopen the same data when preview resumes.

## M3 — larger routines, advanced controls, and paid launch

Enable: `pnpm features enable m3 --env local` (use a legitimate Pro test account for paid capabilities).

**Built:** Shared Free/Pro capability data, active-count enforcement, preference anchors, duration/day and count/week data/solver primitives, buffer/importance/grace fields, deterministic conflict repair, Stripe checkout/portal/webhook foundations, and grant/subscription resolution. The existing activity form supports daily count and a simple morning/afternoon preference—not every stored scheduling option.

**Missing / unfinished:**

- [ ] Final Pro price/allowance, comparison and checkout UI, billing-return route and customer-management experience.
- [ ] Founding-user eligibility, approved offer terms, automatic checkout discount, redemption/deadline tracking and customer messaging.
- [ ] Full advanced-control UI and round-trip semantics. Ranked candidate choices with consequence previews are not completed by enabling the flag.
- [ ] Consistent richer windows/spread/breather policy across schema, initial planner and repair; see [rearrangement](rearrangement.md).
- [ ] Explicit downgrade/over-limit behavior and migration of legacy premium settings; do not silently erase or reinterpret them.
- [ ] Live billing acceptance and legal/support/refund/renewal messaging.

**Manual acceptance:**

- [ ] Enabling flags on Free does not grant Pro. Pro allows the intended controls; direct API calls enforce both availability and entitlement.
- [ ] Each rule survives create/edit, initial placement, calendar repair, pause/resume, restart and downgrade.
- [ ] Turn the flag off: no new advanced settings or larger routine activations, but existing data/records survive.
- [ ] Test checkout, coupon application, webhook reorder/retries, portal, renewal, cancellation/refund and return URLs using the actual configured products before exposing paid signup.

## M4 — week visibility, then weekly planning

Enable the view: `pnpm features enable week_view --env local`
Enable month separately: `pnpm features enable month_view --env local`
Enable weekly planning later: `pnpm features enable weekly_planning --env local`

**Built:** Week/month grids, date/scope helpers, `/scope`, day-range settings/density, bounded range reads and calendar overlap display. Weekly minimum demand exists in the solver/data model. The weekly flag enables the existing future-day planning/materialization paths and gates writes of weekly minima.

**Missing / unfinished:**

- [ ] Full weekly-target authoring and cross-day planning/control UX. There is no whole-week optimizer hidden behind this flag.
- [ ] Final Free/Pro weekly packaging and enforcement. Existing manual future-day planning is a preview surface, not a newly completed paid entitlement.
- [ ] Timezone/day-boundary, DST, stale-response and offline date-cache findings; overview failure must not masquerade as free time.
- [ ] Range-settings commit isolation and responsive week/month layouts.

**Manual acceptance:**

- [ ] View-only preview does not materialize future routines; weekly planning does so only through its documented paths.
- [ ] Week/month ↔ day navigation, account/device zones on opposite sides of midnight, DST, range changes and slow failed responses.
- [ ] Weekly demand versus completed/kept sessions is correct, without duplicate future placements.
- [ ] Disable wider views and open their bookmarked URLs: return to Today without hidden page effects executing.

## M5 — progress, reflection and customization

Enable recap foundation: `pnpm features enable insights --env local`
Enable customization work: `pnpm features enable dashboard_customization --env local`

**Built:** Day progress aggregates, completion/scheduled counters, Today-so-far widget, bundled day-so-far addon, widget capability keys and ordering helpers. Core progress data still supports “To place” even when recap UI is hidden.

**Missing / unfinished:**

- [ ] Weekly recap, longer-range trends/comparisons and their API/UI.
- [ ] Dashboard editor and persisted-layout integration. Several named secondary widgets are still placeholders/unrendered keys.
- [ ] Shareable recap output, preview and privacy defaults. No sharing feature should be advertised yet.
- [ ] Final insight entitlements; analysis is paid depth, while user-record access/privacy rights are not.

**Manual acceptance:**

- [ ] Completion is not inferred from scheduled time. Partial/auto/manual/missed/skipped records have honest labels.
- [ ] Recaps respect account timezone and date range, with offline/stale errors made explicit.
- [ ] Flag off removes insight/secondary widgets even from old cached plans, without hiding missed/unplaced recovery.
- [ ] Any future share preview excludes private calendar/task content by default and requires explicit user approval.

## M6 — reviewed community routines and authoring

Enable: `pnpm features enable community_addons --env local`

**Built:** Addon SDK/contract/tooling, bundled and reviewed-release models, catalog/management UI, permission enforcement, signed/hash-bound distribution foundation, explicit updates, rollback/safe mode and native authority helpers. Community trust/catalog are deliberately empty until actual reviewed releases are promoted.

**Missing / unfinished:**

- [ ] Public-kit publication, support/security channels, licenses/notices review and independent developer onboarding.
- [ ] Production trust roots/signing custody, R2 distribution, review/promotion ownership, and rehearsed revocation/incident response.
- [ ] Packaged adversarial isolation and permission/grant/update/revoke/safe-mode acceptance on each supported platform.
- [ ] Any paid-addon marketplace: seller onboarding, payouts, tax/refunds and commercial model are explicitly out of scope.

Use the full checklists in [addon launch](addon-launch.md); switching this flag on does not satisfy them.

**Manual acceptance:**

- [ ] Enable for only a reviewer account. A public account still cannot discover/install/run community code or call its endpoints.
- [ ] Enabling M6 does not bypass the separate first-party guided/capture/insight releases or hosted Pro entitlements.
- [ ] Disable M6 while an addon runs: frames/host authority unload, data remains, and re-enable respects current approval/grants rather than stale cached authority.

## Cross-cutting launch gates

Safety and reliability are not later features. Before broad M0 distribution, recheck the current [project audit](project-audit.md) and resolve or explicitly mitigate affected paths. In particular:

- Deploy and validate the fixed [social-sign-in handoff](social-signin.md), including its directory migration, before exposing that authentication path. The code and adversarial regressions are implemented; live acceptance is still required ([#13](https://github.com/techswitch-uae/wiseroutine.ai/issues/13)).
- Validate signed installers, updates, deployed API configuration, migrations, and tenant routing ([#17](https://github.com/techswitch-uae/wiseroutine.ai/issues/17)).
- Exercise real Google and Outlook connections and calendar-change repair on supported platforms ([#12](https://github.com/techswitch-uae/wiseroutine.ai/issues/12)).
- Define and validate what happens while the native app is hidden, suspended, restarted, or offline; match product copy to those guarantees ([#18](https://github.com/techswitch-uae/wiseroutine.ai/issues/18)).
- Verify timezone/day boundaries, stale-response handling, pause/skip/occupancy semantics, unplaced work, and settings commit behavior ([#14](https://github.com/techswitch-uae/wiseroutine.ai/issues/14)).
- Establish critical-path browser/native checks, keyboard accessibility, usable narrow-window layouts, actionable errors, and support/recovery paths ([#25](https://github.com/techswitch-uae/wiseroutine.ai/issues/25)).
- Validate privacy/account-data handling and operational budgets ([#16](https://github.com/techswitch-uae/wiseroutine.ai/issues/16)). Feature flags do not reduce the importance of protecting calendar information.

Before M3, separately validate live billing and the founding offer, account/billing management, cancellation and refunds, renewal disclosures, and premium downgrade behavior. Before M6, pass the additional community distribution and public-kit gates.

## Automated verification entry points

```sh
pnpm typecheck
pnpm test
pnpm test:features-cli
pnpm test:core-browser
pnpm test:capture-browser
pnpm test:addon-browser
pnpm test:release
```

- `packages/plans/src/features.test.ts`: default-off, strict parsing, dependencies, account overrides and first-party addon separation.
- `apps/api/src/features.test.ts`: authenticated snapshots, server refusal, cohort isolation, Free placement, pause/move, checkout and attachment rollback.
- `apps/api/src/features-background.test.ts`: core versus guided auto-start/completion behavior in the grace worker.
- `apps/desktop/src/lib/features.test.ts`: publication, failed reads, stale responses, session reset and refresh lifecycle.
- `apps/desktop/e2e/core-release.spec.ts`: actual local Worker/libSQL/browser core shell, preserved template library, direct URL/shortcut hiding, basic creation with Edit/Remove, inline calendar settings, the core hours switch, empty-rail fallback, and a capture-only preview/rollback.
- Existing future-feature suites explicitly opt in. Core tests exercise real all-off defaults instead of changing the application's defaults to satisfy old tests.

### Last recorded implementation pass

- Workspace typecheck and tests passed, including **250 API** (with **9 OAuth handoff regressions**), **400 desktop**, **34 plan/flag** tests and **5 CLI** tests.
- Full desktop browser suite: **39 passed** (core-off plus explicitly enabled future-feature workflows). Fixtures share a morning timezone so remaining-day placement is tested without depending on the operator's local hour; the API clock is not mocked.
- Standalone addon browser suite: **3 passed**. Native Rust unit tests: **25 passed**. Release-configuration tests: **9 passed**.
- Workspace build passed with the production API origin configured. This is not a signed installer or deployment.
- Actual local CLI enable → show → disable was exercised. Local global flags were left all-off; no remote configuration was changed.
- No new code-formatting/lint findings remain from this pass. Repository-wide `pnpm lint` is still blocked by two pre-existing findings in `packages/design/src/components.tsx` (mixed component exports and an effect dependency), plus an unrelated `.design/this-block/canvas.json` formatting issue. Those are not claimed fixed by this work.

Automated checks are not signed-installer, live OAuth/provider, live Stripe, production KV propagation or manual accessibility acceptance. Prior local test counts do not prove current production readiness.
