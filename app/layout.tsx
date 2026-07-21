import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  const baseUrl = new URL(host ? `${protocol}://${host}` : configuredUrl || "http://localhost:3000");
  const title = "RouteForge — USA LCR 2 Rate Deck Builder";
  const description = "Build protected USA NPANXX customer rate decks from persistent vendor defaults.";
  return {
    metadataBase: baseUrl,
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: baseUrl,
      images: [{ url: new URL("/og.png", baseUrl), width: 1731, height: 909, alt: "RouteForge USA LCR 2 Rate Deck Builder" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [new URL("/og.png", baseUrl)],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
