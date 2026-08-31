import type { Metadata } from "next";

import { DocsPage } from "@/features/docs/docs-page";

export const metadata: Metadata = {
  title: "Docs",
  description: "A concise guide to saving, confidential draws, privacy, automation, and withdrawals in ZamOps Pool.",
  alternates: { canonical: "/docs" },
};

export default function DocumentationPage() {
  return <DocsPage />;
}
