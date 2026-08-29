/**
 * Music links, and what may be done with one.
 *
 * Beside the module that uses them rather than inside it, because this is the
 * part of the deep work session with a trust boundary in it: one value the
 * user typed decides both what gets handed to the OS and what gets loaded
 * into an iframe. A boundary is easier to hold to when it can be tested on
 * its own.
 */

/** Only what a browser will hand to another app. A `javascript:` or `file:`
 *  URL in a settings field is not a playlist. */
export const OPENABLE = /^(https?|spotify|music|apple-?music):/i;

/**
 * A Spotify link, turned into the player Spotify will let us embed.
 *
 * Parsed rather than rewritten. This function decides the `src` of an iframe
 * from a string the user typed, so it has to be able to say *no*: it takes
 * the kind and the id out of a shape it recognises and builds a fresh URL
 * from them, which means nothing the user types can end up in the frame
 * except twenty-two characters of Spotify id.
 *
 * Both link shapes, because both are things people paste: the https URL the
 * web player copies, and the `spotify:` URI the desktop app copies.
 */
export function spotifyEmbed(url: string): string | null {
  const kinds = "track|album|playlist|artist|episode|show";
  const web = new RegExp(
    `^https?://open\\.spotify\\.com/(?:intl-[a-z-]+/)?(${kinds})/([A-Za-z0-9]+)`,
    "i",
  ).exec(url);
  const uri = new RegExp(`^spotify:(${kinds}):([A-Za-z0-9]+)$`, "i").exec(url);
  const found = web ?? uri;
  if (!found) return null;
  return `https://open.spotify.com/embed/${found[1]?.toLowerCase()}/${found[2]}`;
}
