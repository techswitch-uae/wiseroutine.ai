import { describe, expect, it } from "vitest";
import { CREED, clock, markup, secondsLeft, spotify } from "./focus";

const THEME = {
  text: "#2e2b25",
  muted: "rgba(0,0,0,.7)",
  hairline: "rgba(0,0,0,.1)",
  fontBody: "system-ui",
  fontHeading: "Georgia",
};

describe("spotify", () => {
  it("takes the web link the player copies", () => {
    expect(
      spotify("https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO"),
    ).toEqual({
      embed: "https://open.spotify.com/embed/playlist/37i9dQZF1DX4sWSpwq3LiO",
      open: "https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO",
    });
  });

  it("takes a localised link", () => {
    expect(
      spotify("https://open.spotify.com/intl-it/track/abc123")?.embed,
    ).toBe("https://open.spotify.com/embed/track/abc123");
  });

  it("normalises a spotify: URI to https", () => {
    // `open:external` allows plain https origins only, so the URI cannot be
    // handed to the machine as it stands. The https link opens the desktop
    // app anyway, which is what the user wanted from either.
    expect(spotify("spotify:album:xyz789")).toEqual({
      embed: "https://open.spotify.com/embed/album/xyz789",
      open: "https://open.spotify.com/album/xyz789",
    });
  });

  it("builds fresh URLs rather than passing the input through", () => {
    // The whole reason this is a parser: the return value becomes an iframe
    // src and an argument to openExternal. Anything after the id is dropped
    // rather than carried along.
    const found = spotify(
      "https://open.spotify.com/track/abc?si=x&utm=y#fragment",
    );
    expect(found?.embed).toBe("https://open.spotify.com/embed/track/abc");
    expect(found?.open).toBe("https://open.spotify.com/track/abc");
  });

  it("refuses anything that is not a Spotify link", () => {
    for (const bad of [
      "",
      undefined,
      null,
      42,
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://evil.example/open.spotify.com/track/abc",
      "https://open.spotify.com.evil.example/track/abc",
      "https://open.spotify.com/",
      "https://open.spotify.com/nonsense/abc",
      "music://album/1",
    ]) {
      expect(spotify(bad)).toBeNull();
    }
  });
});

describe("markup", () => {
  it("draws nothing for music when there is no link", () => {
    const html = markup(null, THEME);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("Open in Spotify");
  });

  it("draws the player for a link that parsed", () => {
    const music = spotify("spotify:playlist:abc") as NonNullable<
      ReturnType<typeof spotify>
    >;
    const html = markup(music, THEME);
    expect(html).toContain(music.embed);
    // Spotify names this as the difference between full playback and previews
    // for a signed-in listener.
    expect(html).toContain("encrypted-media");
  });

  it("draws on a transparent ground, in the host's theme", () => {
    expect(markup(null, THEME)).toContain("background: transparent");
    expect(markup(null, THEME)).toContain(THEME.text);
  });

  it("says the same thing every time", () => {
    expect(markup(null, THEME)).toContain(CREED);
  });
});

describe("clock", () => {
  it("pads the seconds", () => {
    expect(clock(1_500)).toBe("25:00");
    expect(clock(9)).toBe("0:09");
  });
});

describe("secondsLeft", () => {
  it("never goes negative", () => {
    expect(secondsLeft(0, 5_000)).toBe(0);
  });
});
