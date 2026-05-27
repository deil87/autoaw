import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://autoaw.app";
  const now = new Date();
  return [
    { url: base,        lastModified: now, changeFrequency: "weekly",  priority: 1.0 },
    { url: `${base}/demo`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];
}
