const FALLBACK_SITE_URL = "http://localhost:3000";

function deploymentUrl() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : FALLBACK_SITE_URL;
}

export const site = {
  name: "ZamOps Pool",
  description: "Private prize savings with confidential balances, fair deposit-weighted draws, and protected principal.",
  url: (process.env.NEXT_PUBLIC_SITE_URL || deploymentUrl()).replace(/\/$/, ""),
};
