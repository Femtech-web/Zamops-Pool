import type { MetadataRoute } from "next";

import { site } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site.url, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${site.url}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
  ];
}
