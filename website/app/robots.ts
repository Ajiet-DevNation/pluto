import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/lib/site-url";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: publicSiteUrl ? new URL("/sitemap.xml", publicSiteUrl).toString() : undefined,
  };
}
