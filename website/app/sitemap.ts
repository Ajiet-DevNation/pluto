import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/lib/site-url";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicSiteUrl ? [{ url: publicSiteUrl.toString(), changeFrequency: "monthly" }] : [];
}
