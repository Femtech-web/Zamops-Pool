import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/manrope";

import { AppProviders } from "@/components/app-providers";
import { site } from "@/config/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.name,
    template: "%s · ZamOps Pool",
  },
  description: site.description,
  applicationName: site.name,
  keywords: ["confidential DeFi", "private savings", "FHEVM", "Zama", "prize savings", "Ethereum Sepolia"],
  authors: [{ name: "ZamOps" }],
  creator: "ZamOps",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: site.name,
    title: site.name,
    description: site.description,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "ZamOps Pool — confidential prize savings" }],
  },
  twitter: {
    card: "summary_large_image",
    title: site.name,
    description: site.description,
    images: ["/opengraph-image"],
  },
  icons: { icon: "/icon.svg" },
  manifest: "/manifest.webmanifest",
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("zamops-pool-theme-v2");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}}catch(e){}` }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
