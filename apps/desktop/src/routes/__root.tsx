import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

const RootDocument = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Wise Routine",
      },
      {
        // Colours the browser chrome around the app — the address bar on
        // Android, the title bar of an installed PWA. Left unset it is white,
        // which is a colour this product does not contain.
        name: "theme-color",
        content: "#c67139",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Declared rather than left to convention: a browser will guess at
      // /favicon.ico, but nothing guesses at the manifest or the touch icon,
      // and without the manifest an installed app has no name.
      { rel: "icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/logo192.png" },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),

  shellComponent: RootDocument,
});
