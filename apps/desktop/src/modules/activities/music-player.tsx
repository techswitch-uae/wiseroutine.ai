import { Button } from "@wiseroutine/design";
import { spotifyEmbed } from "../../lib/music";
import { openExternal } from "../../lib/open-external";

/**
 * The player, inside the session.
 *
 * Spotify's own troubleshooting page is clear about the ceiling: without a
 * listener signed in to Spotify in this same context - and nobody is, inside
 * a desktop app - the embed plays thirty-second previews. So the link out
 * stays, right underneath it, and is the thing to press for the whole
 * playlist. The embed is worth having anyway: it says what is queued and lets
 * you start it without leaving the block.
 *
 * `allow="encrypted-media"` is load-bearing - Spotify names it as the
 * difference between full playback and previews for anyone who *is* signed
 * in, and dropping it is the documented way to get previews forever.
 */
export const Player: React.FC<{ url: string }> = ({ url }) => {
  const embed = spotifyEmbed(url);

  if (!embed) {
    // Apple Music, a radio stream, anything else. Nothing to embed, so the
    // only honest offer is the app that owns it.
    return (
      <Button variant="secondary" onClick={() => void openExternal(url)}>
        Play music
      </Button>
    );
  }

  return (
    <div style={{ width: 420, maxWidth: "100%" }}>
      <iframe
        title="Music for this block"
        src={embed}
        width="100%"
        height="152"
        style={{ border: 0, borderRadius: 12 }}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
      />
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="wr-linklike"
          onClick={() => void openExternal(url)}
        >
          Open in Spotify for the full tracks
        </button>
      </div>
    </div>
  );
};
