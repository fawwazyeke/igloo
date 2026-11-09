import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

// App type: Inter for body text, Manrope for headings, JetBrains Mono for codes and small labels and numbers.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const head = Manrope({ subsets: ["latin"], variable: "--font-head" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Igloo",
  description: "No AI on our side. Just the shared brain your AIs plug into.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${head.variable} ${mono.variable}`}>
      <head>
        {/* Satoshi Bold, only for the "igloo." wordmark. Free under the ITF Free Font License, served by Fontshare (its publisher). */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
