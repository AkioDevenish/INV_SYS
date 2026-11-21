import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { APP_NAME, ORG_NAME } from "@/lib/brand";
import "./globals.css";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: `Inventory, calendar, timelines, vendors and stakeholder directory for the ${ORG_NAME}.`,
  robots: {
    index: false,
    follow: false,
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Light or dark is set server-side from the saved choice; "system" leaves it to the CSS media query.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      data-theme={theme === "system" ? undefined : theme}
      suppressHydrationWarning
    >
      {/*
       * Browser extensions inject attributes into <body> before React hydrates
       * - ColorZilla adds cz-shortcut-listen, Grammarly adds its own - and the
       * mismatch against the server-rendered markup throws a hydration error
       * that nothing in this codebase can prevent. suppressHydrationWarning
       * silences it for this element's own attributes only; mismatches in the
       * page content below are still reported.
       */}
      <body className="app-aurora min-h-screen antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
