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

export const metadata: Metadata = {
  title: "AutoAW — Auto Agentic Workflows",
  description: "Automatically discover optimal multi-agent workflow configurations.",
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
