const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const publicSiteUrl = configuredUrl ? new URL(configuredUrl) : null;

if (publicSiteUrl && publicSiteUrl.protocol !== "https:") {
  throw new Error("NEXT_PUBLIC_SITE_URL must use https://");
}
