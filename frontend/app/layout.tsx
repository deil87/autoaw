import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { Nav } from "@/components/nav";
import { AuthProvider } from "@/contexts/auth-context";
import { AuthGuard } from "@/components/auth-guard";
import "./globals.css";

const geist = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
  preload: false,
});

const SITE_URL = "https://autoaw.app";
const TITLE = "AutoAW — Auto Agentic Workflows";
const DESCRIPTION =
  "AutoAW automatically discovers optimal multi-agent workflow configurations — co-evolving topology, prompts, models, and tools to find the cheapest pipeline that still hits your quality bar.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | AutoAW" },
  description: DESCRIPTION,
  keywords: [
    "agentic workflows",
    "multi-agent optimization",
    "LLM workflow",
    "Pareto optimization",
    "AutoAW",
    "AI agent",
    "prompt optimization",
  ],
  authors: [{ name: "AutoAW Labs" }],
  creator: "AutoAW Labs",
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "AutoAW",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "AutoAW — Auto Agentic Workflows" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <Script src="https://www.googletagmanager.com/gtag/js?id=G-SVN9EY5D4Y" strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-SVN9EY5D4Y');
      `}</Script>
      <body className={`${geist.variable} ${geistMono.variable}`}
            style={{ fontFamily: "var(--font-geist, var(--sans))" }}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "AutoAW",
              description: DESCRIPTION,
              url: SITE_URL,
              applicationCategory: "DeveloperApplication",
              operatingSystem: "Web",
              offers: [
                { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Research & Personal" },
                { "@type": "Offer", name: "Enterprise", description: "Custom pricing for commercial use" },
              ],
              creator: { "@type": "Organization", name: "AutoAW Labs", url: SITE_URL },
            }),
          }}
        />
        <AuthProvider>
          <Nav />
          <main className="aw-page">
            <AuthGuard>{children}</AuthGuard>
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
