import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/manrope";

import { AppProviders } from "@/components/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ZamOps Pool",
    template: "%s · ZamOps Pool",
  },
  description:
    "Private prize savings with confidential balances, fair deposit-weighted draws, and protected principal.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf6" },
    { media: "(prefers-color-scheme: dark)", color: "#171815" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
