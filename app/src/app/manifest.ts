import type { MetadataRoute } from "next";

import { site } from "@/config/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: "ZamOps Pool",
    description: site.description,
    start_url: "/",
    display: "standalone",
    background_color: "#171815",
    theme_color: "#171815",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
