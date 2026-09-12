# Wise Routine launch and expansion strategy

**Status:** Working strategy. The direction is a free basic launch, optional paid features later, and a discount for early users. Specific limits, discount terms, pricing, and rollout thresholds below are recommendations requiring approval.

**Scope:** Product packaging, release order, communications, acquisition, and feature rollout. This document does not implement flags, change entitlements, activate billing, or establish production readiness.

**Relationship to existing docs:** This is the proposed commercial direction going forward. Statements about unchanged Free/Pro capabilities in [addon launch](addon-launch.md) and [capture and rescheduling](capture-and-rescheduling.md) describe those implementations, not this future strategy. The current code still needs to be reconciled with this plan. [Release preparation](releasing.md) and the [project audit](project-audit.md) remain separate technical launch gates.

## 1. Strategy in one page

### The promise

> Tell Wise Routine what you want to make time for. It finds room around your meetings—and adapts when your day changes.

Launch a small, complete experience, not a collection of partially exposed features. **Creating activities, automatic placement, and automatic rearrangement must ship together and be available on Free.**

### The business approach

1. Launch a useful free core, with no card required and no automatic conversion into a subscription.
2. Acquire broadly, but optimize for people who establish and repeatedly use a routine—not just account registrations.
3. Disclose from the beginning that optional paid features are coming. Do not imply that the launch is an expiring trial.
4. Release additional capabilities in outcome-focused milestones. Alternate free improvements with paid depth rather than turning every announcement into an upsell.
5. Introduce Pro when a coherent premium package is ready and users demonstrate recurring demand. Do not charge for a roadmap.
6. Reward early users with a clear, bounded founding-user discount.
7. Keep the launched basic scheduling experience free. Charge for larger routines, advanced controls, planning depth, and analysis—not basic reliability or recovery from scheduling problems.

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

## 3. Milestone 0: the minimum complete free product

### Included at launch

| Capability | Launch scope |
| --- | --- |
| Activity creation | Custom name, duration, and simple daily frequency. A few starter suggestions, such as focus, walking, and stretching. |
| Calendar connection | Read-only busy-time integration. Launch with the provider(s) and platform(s) actually validated; one provider/platform is acceptable if clearly disclosed. |
| Availability | Working days, working hours, and timezone, with sensible scheduling defaults. |
| Automatic placement | Place activities into available gaps in the remaining day. The user should not have to manually assemble the routine. |
| Automatic adaptation | Repair affected activities when calendar changes create conflicts. Keep unaffected activities stable wherever possible. |
| Today view | Meetings, planned activities, and Up Next. Show a clear distinction between confirmed placement, suggestions, and unplaced work. |
| Follow-through | Start, complete, skip, pause an activity definition, move an occurrence, and use a plain timer. Optional reminders with recoverable permission settings. |
| Recovery and explanation | Explain moves, show work that could not fit, ask before unsuitable changes, and provide basic change-time controls. |
| Trust essentials | Clear sync/error states, privacy controls, account recovery, support, and account/data rights appropriate for launch. None are premium benefits. |

**Recommended free allowance, subject to approval:** three active activity definitions. This supports a small routine such as focus + walk + eye rest. A daily occurrence is not a separate activity definition; technical recurrence limits still apply. Paused and archived activities should not consume the active allowance.

The repository currently allows two active activities on Free. Changing that number is a product and implementation decision, not something this document has done. Confirm and disclose the allowance before launch; do not start with unlimited access and later shrink it without an explicit migration policy.

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

**Do not hide the unplaced-activity recovery surface with Inbox.** Basic move, skip, pause, and scheduling recovery remain part of the core. Keep addon architecture internally where useful; hiding the ecosystem does not require rewriting the application.

## 4. Free, Pro, and the founding-user offer

### Packaging rule

**Free proves and delivers the promise. Pro expands its scope and control.**

| Keep free | Recommended Pro value |
| --- | --- |
| A small active routine with automatic placement and basic adaptive rearrangement | A higher active-activity allowance; exact limit to be decided |
| Working hours, timezone, simple daily recurrence, and basic move/pause/skip controls | Richer recurrence, preferred periods, configurable buffers, and ranked placement choices |
| Plain timer and the initial curated guided experiences | Future specialized services only where independently valuable; do not base Pro on hiding open addon source |
| Basic Quick Capture, Inbox, notes, links, and bounded attachments when released | Expanded storage only if demand and operating costs justify a separate, disclosed allowance later |
| Today and, later, a read-only week overview | Weekly targets and cross-day planning controls when fully implemented |
| Basic completion counts and access to the user's records | Longer-range trends, comparisons, and dashboard customization |
| Privacy, export/deletion access, reconnection, error recovery, security, and correctness | Never sell fixes to core reliability as premium features |
| Curated community access when safe to launch | Hosted premium capabilities remain entitled regardless of which client or addon invokes them |

Basic automatic adaptation is distinct from **ranked alternatives and advanced constraints**. The former is core and free; the latter can be Pro. Avoid using “smart scheduling” to describe only the paid tier.

If a basic calendar provider ships later for readiness reasons, treat that as an availability expansion, not automatically as a premium feature. Do not create artificial sync delays for free users that undermine the core promise.

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

Store founding eligibility separately from both subscription entitlements and beta grants. An early free user is not an expiring Pro subscriber. Ensure legitimate prelaunch users are considered when eligibility is backfilled, and existing grants or purchases are not silently overwritten.

A general statement that early users will receive a discount can precede finalized pricing. Before publishing that statement, still define and record who qualifies. Reserve “30% for 12 months” copy for the approved offer.

### Downgrade principles

Never delete activities, captures, or history because a subscription ends. Let users choose which activities remain active within the free allowance. Specify how premium recurrence/preferences fall back or pause before selling them; do not silently reinterpret a complex routine into a different schedule. Keep access to records and free-tier recovery controls.

## 5. Ordered release roadmap

This is a product release order, not an assertion that every item already exists or is ready. Some capabilities are implemented but hidden; others require integration or new work. Readiness is assessed per milestone.

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
- A second validated calendar provider or native platform can be a meaningful reach announcement whenever ready; it does not need to wait for the premium roadmap.
- Shareable routine templates are a promising later acquisition experiment, but are **new work**, not a capability assumed to exist because addons do. Default sharing must omit calendar details and personal content.

## 6. What to communicate at each milestone

All copy below is a draft. Use launch wording only after the feature is available to the stated audience. Replace placeholders, confirm terms, and verify claims before publication. Clearly label previews and limited cohorts.

### Before M0 — recruit around the problem

**Message:** The day changes; maintaining a routine should not require manually rebuilding it.

**Post:**

> What keeps getting pushed out of your workday: focus time, a walk, or a proper break? We're building Wise Routine to find room around your meetings and adapt when plans change. The basic version will be free, with optional paid features later. Join the launch list: [link].

**CTA:** Join the launch list and name one activity that gets displaced.

**Execution:** Share short, labeled prototype demos. Recruit a small design-partner cohort before broad distribution. A mailing-list signup is not founding-account eligibility unless that is explicitly added to the approved offer.

### M0 — launch the complete free core

**Headline:** A smarter routine. Less rearranging your day.

**Post:**

> Wise Routine is here. Choose what you want to make time for, let it find room around your meetings, and watch your routine adapt when plans change. The basic version is free, with no credit card required. Optional paid features are coming later, and early users will receive a founding-user discount. Available for [validated platforms/providers]. Try it: [link].

**Signup/FAQ reassurance:**

> This is a free basic version, not an expiring trial. We plan to offer optional paid features for larger routines and more control. You won't be charged unless you choose to upgrade.

**CTA:** Create your first activity.

**Execution:** Publish the placement → meeting change → repair demo. Use one canonical landing page, relevant communities that permit launches, and personal outreach. Show limits and actual platform availability before download. Ask early users which placement felt helpful or wrong.

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

## 7. How to release feature by feature

### Separate three different decisions

1. **Release availability:** Is this feature ready for this account/cohort and client version?
2. **Entitlement:** Does the account's Free/Pro plan include it?
3. **Preference:** Has the user enabled it, where an opt-in is appropriate?

A release flag must not masquerade as a subscription. Founding-discount eligibility is a fourth, separate commercial record. Beta access, if offered, is explicitly labeled with its own terms and does not silently become a charge.

### Suggested release flags

These names are proposed; no flag system is claimed to exist yet.

| Flag | Purpose | Initial public state |
| --- | --- | --- |
| `guided_sessions` | Curated specialized session entry points | Off |
| `quick_capture` | Capture palette and task creation workflow | Off |
| `inbox` | Captured-work management; requires compatible capture support, but never owns core unplaced-routine recovery | Off |
| `capture_files` | Attachment UI, upload paths, and native export capability | Off |
| `advanced_scheduling` | Advanced controls and ranked alternatives, with Pro entitlement checked separately | Off |
| `week_view` | Week overview | Off |
| `weekly_planning` | Weekly targets/control; depends on week support and Pro | Off |
| `insights` | Recap and analysis surfaces, with basic/Pro capabilities evaluated separately | Off |
| `dashboard_customization` | Widget selection and ordering, subject to Pro | Off |
| `community_addons` | Discovery, install, and community distribution; separate from bundled addon internals | Off |
| `billing_checkout` | Entry into the validated paid purchase flow | Off |

Keep the launched core available by default. Operational emergency controls must not silently turn a free smart routine into manual-only scheduling; show an honest degraded state and recovery guidance during an incident.

### Repeatable rollout procedure

1. **Define the slice.** Write down the user problem, exact included behavior, Free/Pro boundary, dependencies, supported versions, acceptance tests, success signals, and rollback behavior.
2. **Prepare dark.** Deploy backward-compatible storage/API support and code with new public entry points off. Flags do not replace migrations, authorization, or client-version compatibility.
3. **Test internally.** Exercise supported platforms, real relevant integrations, permissions, direct URLs/API calls, account switching, offline/reconnect behavior, and the flag-off path.
4. **Invite an early-access cohort.** Use stable account-level assignment so a user's feature does not flicker between requests or devices. Identify the release as a preview and provide a feedback channel.
5. **Review evidence.** Compare activation, errors, scheduling corrections, support reports, and operating costs with the previous release. Fix material issues before expanding.
6. **Expand gradually.** For example: internal → invited testers → 10% → 50% → all eligible accounts. These percentages are illustrative; for a small user base, hand-selected cohorts and direct feedback are more useful than false statistical precision.
7. **Announce availability.** Send the broad announcement at general availability. Earlier posts must say “preview” or “rolling out,” and billing/plan copy must match actual access.
8. **Follow up and stabilize.** Publish an example or user story with consent, review the first complete usage cycle, and remove obsolete rollout branches after the agreed support window. Keep a documented operational rollback path.

A developer test account with all features enabled is not evidence that the intended Free, Pro, founding-user, and flag-off combinations work.

### Enforcement and rollback rules

- Enforce release availability and entitlements on the server wherever behavior or data access requires it. UI hiding alone is not a gate.
- Cover navigation, keyboard shortcuts, deep links, APIs, scheduled jobs, tray actions, widgets, and addon-originated calls. Installing an addon must not bypass hosted feature restrictions.
- Gate new background behavior consistently. Turning off a feature must not strand in-flight operations, linked records, or required core scheduling work.
- On rollback, disable unsafe new actions while preserving user data and safe access/recovery. For example, an upload rollback can stop new uploads without cutting off safe downloads of existing files.
- Define how existing sessions and previously created premium schedules behave when flags or entitlements change. Avoid surprise activity deletion or whole-day reshuffles.
- Give release flags an owner, dependency list, last-change audit record, and removal/review condition. Avoid permanent unexplained flag combinations.
- Use safe defaults on configuration failure: keep the established core working, and fail closed for unreleased or unauthorized capabilities.

### Communications rhythm for each release

- **Before preview:** One problem-focused teaser and an opt-in tester invitation.
- **During preview:** Direct feedback, labeled demos, and readiness work—not a false general-availability announcement.
- **At general availability:** One short demo, a launch post, release notes, a targeted email where permitted, and a dismissible in-app announcement with the Free/Pro label.
- **After launch:** One practical example or consented user story, a feedback question, and a review of usage and support issues.

Maintain a public changelog and a restrained “Now / Next / Exploring” roadmap. Do not publish speculative deadlines. Avoid repeatedly emailing inactive users or conditioning access on marketing consent; honor communication preferences and unsubscribe requirements.

## 8. Measure growth, value, trust, and cost

### Initial funnel

**Account created → first real activity auto-placed → first completion → routine used on subsequent days.**

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

## 9. Repository implications and launch gates

### Changes needed to support this strategy

| Area | Current evidence / required follow-up |
| --- | --- |
| Plan capabilities | `packages/plans/src/index.ts` currently gives Free two active activities and disables `adaptiveReplan` and `rankedRearrange`. Enable core automatic planning/adaptation for Free, decide the allowance, and keep ranked alternatives distinct if reserved for Pro. |
| Capability enforcement | Update API/job behavior and client messaging together, with explicit Free/Pro tests. Do not merely hide upgrade prompts or issue expiring Pro grants to every free user. |
| Existing commercial copy | Reconcile plan screens, trial UI, onboarding, and older commercial recommendations in the addon/capture docs when implementation changes. Keep historical verification records accurate. |
| Founding-user records | Design durable eligibility, offer-version, activation/redemption tracking, account UI, and checkout application. Existing beta grants are not a substitute. |
| Release configuration | Add coherent account-level release availability and enforce dependencies across client, API, jobs, and addon access. This is separate from `can()` subscription decisions. |
| Initial shell | Hide future navigation and actions; retain Today, activity setup, calendar/settings access, Up Next, and unplaced-activity recovery. |
| Guided sessions | `apps/desktop/src/modules/activities/index.ts` supports plain timed fallback without a specialized module. Preserve this separation when hiding guided/addon surfaces. |
| Capture | Use [capture and rescheduling](capture-and-rescheduling.md) for transactional behavior, storage limits, migrations, and native acceptance. Do not remove core change-time controls with the capture flags. |
| Advanced scheduling | Verify each rule across persistence, initial placement, repair, UI, and tests. Solver support or a simulator scenario does not by itself establish product support; see [rearrangement](rearrangement.md). |
| Addon distribution | Keep the customer ecosystem hidden until the operational/security gates in [addon launch](addon-launch.md) pass. The SDK being open does not make hosted Pro capabilities free. |

### Safety and reliability are not later features

Before broad M0 distribution, recheck the current audit and resolve or explicitly mitigate affected paths. In particular:

- Address the documented social-sign-in handoff concern before exposing that authentication path; hiding its button is not sufficient mitigation for an accessible endpoint.
- Validate signed installers, updates, deployed API configuration, migrations, and tenant routing.
- Exercise real calendar connections and calendar-change repair on supported platforms.
- Define and validate what happens while the native app is hidden, suspended, restarted, or offline. Match product copy to those guarantees.
- Verify timezone/day boundaries, stale-response handling, pause/skip/occupancy semantics, unplaced work, and settings commit behavior.
- Establish critical-path browser/native checks, keyboard accessibility, usable narrow-window layouts, actionable errors, and support/recovery paths.
- Validate privacy/account-data handling and operational budgets. Feature flags do not reduce the importance of protecting calendar information.

Before M3, separately validate live billing and the founding offer, account/billing management, cancellation and refunds, renewal disclosures, and premium downgrade behavior. Before M6, pass the additional community distribution and public-kit gates.

The repository's prior local test counts do not prove current production readiness. This strategy document does not close any audit finding.

## 10. Decisions and execution checklist

### Approve before the free launch

- [ ] Confirm the free-core boundary: automatic placement and basic adaptive rearrangement included.
- [ ] Confirm the active-activity allowance; recommendation: three, versus two in current code.
- [ ] Choose and validate launch platforms/providers and the actual synchronization/background guarantees.
- [ ] Define founding eligibility before promising it; approve exact discount terms before publishing them. Recommendation: 30% for 12 months, redeem within 90 days of Pro general availability.
- [ ] Establish a sustainable operating budget and disclose relevant technical limits without undermining ordinary routine use.
- [ ] Assign owners for product decisions, release operations/rollback, support/incidents, and communications. One person can fill several roles, but each needs a named owner.

### Implement and validate M0

- [ ] Change entitlements and related tests/copy deliberately; keep prior grants and account data safe.
- [ ] Add founding eligibility tracking and the proposed release controls.
- [ ] Reduce the shell/onboarding to the complete core; test hidden entry points and dependencies.
- [ ] Resolve applicable audit/release gates and exercise a live end-to-end free-user journey.
- [ ] Prepare landing page, FAQ, privacy/support information, demo, welcome message, and permitted launch channels.
- [ ] Instrument the core funnel and trust/cost signals, establish cohort baselines, then expand beyond design partners.

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

**Bottom line:** Use Free to establish trust and a daily habit. Use successive releases to deepen that value and create honest reasons to return. Monetize additional scope and control once they are useful—not the core promise that brought people in.
