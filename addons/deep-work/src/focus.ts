/**
 * A focus block: one line, a clock, and whatever you put on to work to.
 *
 * An addon, like every guided session Wise Routine ships. `main.ts` is the
 * entry; this half is pure. See `addons/breathing` for the reference.
 *
 * ## The two capabilities this needs, and why they are two
 *
 * A music link is one value the user typed that decides two different things:
 * what gets loaded into an iframe (`ui:embed`) and what gets handed to the
 * operating system (`open:external`). They are separate capabilities because
 * they are separate risks with separate enforcement points - the first becomes
 * a `frame-src` the browser enforces, the second a check the host runs on
 * every call. Both are scoped to `https://open.spotify.com` and nothing else,
 * which is the whole allowance this addon has.
 *
 * ponytail: a link and an embed, not the Spotify Web API. The API would let
 * the session pause the music at the end, and costs an OAuth flow, a token
 * refresh and a Premium requirement. Add it when someone asks for
 * pause-on-break.
 */

/** Why the next twenty-five minutes are worth defending. One line, and it does
 *  not change - a session is not the place to be read something new. */
export const CREED =
  "One thing, until the clock runs out. Everything else can wait.";

export const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export const secondsLeft = (endsAt: number, now: number): number =>
  Math.max(0, Math.round((endsAt - now) / 1000));

const KINDS = "track|album|playlist|artist|episode|show";

/**
 * A Spotify link, as this addon is allowed to use it.
 *
 * Parsed rather than rewritten, and this is the trust boundary in the addon:
 * the return value becomes an iframe `src` and an argument to the host's
 * `openExternal`, from a string the user typed. So it takes the kind and the
 * id out of a shape it recognises and builds two fresh URLs from them - which
 * means nothing typed can reach either place except the kind and twenty-two
 * characters of Spotify id.
 *
 * Both link shapes, because both are things people paste: the https URL the
 * web player copies, and the `spotify:` URI the desktop app copies. The URI is
 * normalised to its https form rather than passed through, because
 * `open:external` allows plain https origins only - a custom scheme is an
 * instruction to the machine wearing a link's clothes, and an addon does not
 * get to send one. Opening the https link lands in the desktop app anyway.
 *
 * A link that is not Spotify's returns null and nothing is drawn for it. The
 * built-in version this replaces accepted any openable URL, including
 * `music:` and `apple-music:`. That breadth does not survive the sandbox and
 * should not: an addon that may open anything is an addon that may open
 * anything.
 */
export function spotify(url: unknown): { embed: string; open: string } | null {
  if (typeof url !== "string" || url === "") return null;

  const web = new RegExp(
    `^https?://open\\.spotify\\.com/(?:intl-[a-z-]+/)?(${KINDS})/([A-Za-z0-9]+)`,
    "i",
  ).exec(url);
  const uri = new RegExp(`^spotify:(${KINDS}):([A-Za-z0-9]+)$`, "i").exec(url);

  const found = web ?? uri;
  const kind = found?.[1]?.toLowerCase();
  const id = found?.[2];
  if (!kind || !id) return null;

  return {
    embed: `https://open.spotify.com/embed/${kind}/${id}`,
    open: `https://open.spotify.com/${kind}/${id}`,
  };
}

export interface Theme {
  text: string;
  muted: string;
  hairline: string;
  fontBody: string;
  fontHeading: string;
}

/**
 * The document body.
 *
 * The player is drawn only for a link that parsed. A row saying "no music set"
 * would be a line about something the session does not do, in the middle of a
 * focus block, which is the one place least able to afford it.
 *
 * `allow="encrypted-media"` is load-bearing - Spotify names it as the
 * difference between full playback and previews for a signed-in listener, and
 * dropping it is the documented way to get previews forever.
 *
 * No backticks in the CSS: this is a template literal and one would end it.
 */
export function markup(
  music: { embed: string; open: string } | null,
  theme: Theme,
): string {
  const player = music
    ? `<div class="music">
  <iframe title="Music for this block" src="${music.embed}" width="100%" height="152"
    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
    loading="lazy"></iframe>
  <button type="button" class="out">Open in Spotify for the full tracks</button>
</div>`
    : "";

  return `<style>
  html, body { background: transparent; margin: 0; height: 100%; }
  .wrap {
    height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 16px;
    color: ${theme.text};
    font-family: ${theme.fontBody};
    text-align: center;
  }
  .left { font: 400 64px/1 ${theme.fontHeading}; font-variant-numeric: tabular-nums; }
  .what { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; opacity: .65; }
  .creed { font-size: 18px; line-height: 1.45; max-width: 420px; margin: 0; }
  .music { width: 100%; max-width: 420px; }
  .music iframe { border: 0; border-radius: 12px; }
  .out {
    margin-top: 8px; background: none; border: 0; cursor: pointer; padding: 0;
    font: 400 12.5px ${theme.fontBody}; color: ${theme.text};
    text-decoration: underline; text-underline-offset: 3px; opacity: .75;
  }
  .out:hover { opacity: 1; }
  .out[disabled] { cursor: default; text-decoration: none; opacity: .5; }
</style>
<div class="wrap">
  <div class="what"></div>
  <div class="left" aria-live="off">--:--</div>
  <p class="creed">${CREED}</p>
  ${player}
</div>`;
}
