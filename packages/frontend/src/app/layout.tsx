import type { Metadata } from "next";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { Shell } from "@/components/layout/Shell";
import "@/design-tokens/globals.css";

export const metadata: Metadata = {
  title: "Fedi+ — Google+ Reborn on the Fediverse",
  description:
    "A federated social platform inspired by Google+, powered by ActivityPub.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <Shell>{children}</Shell>
        </ThemeProvider>
      </body>
    </html>
  );
}
