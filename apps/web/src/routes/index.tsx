// biome-ignore-all lint/correctness/useUniqueElementIds: Singleton page IDs are public deep-link anchors, not reusable component IDs.
import { createFileRoute } from "@tanstack/react-router";
import { BrandMark, CheckGlyph } from "@wiseroutine/design";
import { SampleDay } from "../components/sample-day";
import { release } from "../lib/release";

const title = "Wise Routine — Make room for what matters";
const description =
  "Choose what you want to make time for. Wise Routine finds room around your meetings and adapts when your day changes. A free core with 3 active activities.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Wise Routine" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: "https://wiseroutine.ai/" },
      {
        property: "og:image",
        content: "https://wiseroutine.ai/social-card.png",
      },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content:
          "Wise Routine: make room for what matters. A sample calendar with deep work and a walk around meetings.",
      },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://wiseroutine.ai/" }],
  }),
  component: LandingPage,
});

const questions = [
  {
    question: "Is this a free trial?",
    answer:
      "No. The free core includes 3 active activities, automatic placement and basic rearrangement. No credit card. No trial countdown. Optional paid features will come later; upgrading will be your choice.",
  },
  {
    question: "What counts as one activity?",
    answer:
      "An activity is something you want to make time for, like Deep work or Walk. Repeating it during the day doesn’t use another activity slot. You can keep 3 active at once.",
  },
  {
    question: "Does it change my Google or Outlook calendar?",
    answer:
      "No. Calendar connections read busy times; Wise Routine doesn’t move your meetings or write activities back to your calendar. Your routine lives in Wise Routine.",
  },
  {
    question: "Do I have to share meeting details?",
    answer:
      "You can turn off “Save meeting details” in Settings. Wise Routine then keeps busy times, not saved titles, notes or call links. Turning it off also removes previously saved meeting details.",
  },
  {
    question: "What happens when my day is full?",
    answer:
      "Activities that can’t fit stay visible. You can move or skip them. A change that needs your decision is a suggestion, not a silently confirmed plan.",
  },
  {
    question: "Where can I use it?",
    answer:
      release.status === "preview"
        ? "Create your free account now. Wise Routine is preparing for its desktop launch with Google Calendar and Outlook; supported platforms and downloads will be listed here after validation. The sample above is a preview, not the full app."
        : "Choose a validated desktop download below. Each lists its platform and requirements. The sample above is a browser preview, not the full app.",
  },
];

function LandingPage() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header page-width">
        <a className="brand" href="/" aria-label="Wise Routine home">
          <BrandMark size={35} />
          <span>Wise Routine</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#free">What’s free</a>
          <a href={release.signupUrl}>Sign in</a>
          <a className="site-button small" href={release.signupUrl}>
            Start free <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>

      <main id="main">
        <section className="hero page-width" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" />
              Make time for what matters
            </p>
            <h1 id="hero-heading">
              Your day changes.
              <br />
              Your routine <span>comes with it.</span>
            </h1>
            <p className="hero-description">
              Make time for focus, a walk, a proper break. Wise Routine fits
              them around your meetings—and adapts when plans change.
            </p>
            <div className="hero-actions">
              <a className="site-button" href={release.signupUrl}>
                Create free account <span aria-hidden="true">↗</span>
              </a>
              <a className="text-link" href="#demo">
                See how it works <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="hero-reassurance">
              3 active activities. No credit card. Not a trial.
            </p>
            <div className="calendar-note">
              <span>Built around the calendar you have</span>
              <div>
                <span className="provider-badge">G</span> Google Calendar{" "}
                <span className="provider-badge outlook">O</span> Outlook
              </div>
              {release.status === "preview" ? (
                <small>Launch integrations · validation in progress</small>
              ) : null}
            </div>
          </div>
          <SampleDay id="demo" />
        </section>

        <section
          className="how-section page-width"
          id="how-it-works"
          aria-labelledby="how-heading"
        >
          <div className="section-heading">
            <p className="eyebrow">Less calendar Tetris</p>
            <h2 id="how-heading">
              Choose the routine.
              <br />
              Not every time slot.
            </h2>
          </div>
          <ol className="steps">
            <li>
              <span className="step-number">01</span>
              <h3>Say what matters.</h3>
              <p>
                Pick an activity, a duration and how often. Confirm your working
                hours.
              </p>
              <div className="step-example">
                <span className="focus-dot" />
                Deep work <span>45 min · daily</span>
              </div>
            </li>
            <li>
              <span className="step-number">02</span>
              <h3>Let it find room.</h3>
              <p>
                Connect your calendar. Your activities land in the gaps around
                meetings.
              </p>
              <div className="step-example">
                <span aria-hidden="true">↳</span>09:30–10:15{" "}
                <span>Room for focus</span>
              </div>
            </li>
            <li>
              <span className="step-number">03</span>
              <h3>Keep going.</h3>
              <p>
                A meeting changes? Affected activities find a new place. The
                rest stays put where possible.
              </p>
              <div className="step-example">
                <span aria-hidden="true">↗</span>Deep work moved{" "}
                <span>Walk unchanged</span>
              </div>
            </li>
          </ol>
        </section>

        <section
          className="free-section page-width"
          id="free"
          aria-labelledby="free-heading"
        >
          <div className="free-card">
            <div className="free-intro">
              <p className="eyebrow">A small routine. A real difference.</p>
              <h2 id="free-heading">
                The important part
                <br />
                is free.
              </h2>
              <p>Not a trial. Not a manual-only version.</p>
              <a className="site-button light" href={release.signupUrl}>
                Create free account <span aria-hidden="true">↗</span>
              </a>
            </div>
            <div className="free-inclusions">
              <div className="free-price">
                Free <span>No credit card required</span>
              </div>
              <ul>
                <li>
                  <CheckGlyph aria-hidden="true" />3 active activities, with
                  daily repeats
                </li>
                <li>
                  <CheckGlyph aria-hidden="true" />
                  Automatic placement around meetings
                </li>
                <li>
                  <CheckGlyph aria-hidden="true" />
                  Basic rearrangement when plans change
                </li>
                <li>
                  <CheckGlyph aria-hidden="true" />
                  Start, complete, skip or change the time
                </li>
              </ul>
              <p>
                Later: optional paid features for larger routines and more
                control. No automatic paid enrollment.
              </p>
            </div>
          </div>
        </section>

        <section
          className="faq-section page-width"
          id="questions"
          aria-labelledby="faq-heading"
        >
          <div className="section-heading">
            <p className="eyebrow">A few good questions</p>
            <h2 id="faq-heading">
              No fine-print
              <br />
              surprises.
            </h2>
          </div>
          <div className="faq-list">
            {questions.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className="download-section page-width"
          id="get-the-app"
          aria-labelledby="download-heading"
        >
          <BrandMark size={54} />
          <p className="eyebrow">Make a little room</p>
          <h2 id="download-heading">
            Your routine deserves
            <br />a place in your day.
          </h2>
          <p>Create your free account. Make room for what matters.</p>
          <a className="site-button" href={release.signupUrl}>
            Create free account <span aria-hidden="true">↗</span>
          </a>
          <small>Free core now. Optional paid features later.</small>
          {release.status === "preview" ? (
            <p className="download-availability">
              Desktop downloads are getting ready. Validated platforms will be
              listed here at launch.
            </p>
          ) : (
            <div className="downloads">
              {release.downloads.map((download) => (
                <div key={download.platform}>
                  <a className="site-button" href={download.url}>
                    Download for {download.platform}{" "}
                    <span aria-hidden="true">↓</span>
                  </a>
                  <small>{download.requirements}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="site-footer page-width">
        <a className="brand" href="/" aria-label="Wise Routine home">
          <BrandMark size={26} />
          <span>Wise Routine</span>
        </a>
        <span>A routine that moves with you.</span>
        <a href="#get-the-app">Desktop availability</a>
        <a href="#questions">Questions & calendar privacy</a>
      </footer>
    </>
  );
}
