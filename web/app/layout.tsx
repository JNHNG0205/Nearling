import type { Metadata } from "next";
import { DM_Mono, Figtree, Pixelify_Sans } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Providers } from "./providers";

const pixel = Pixelify_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-pixel" });
const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-figtree" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono" });

export const metadata: Metadata = {
  title: "Petto, an AI Tamagotchi that pays for its own thoughts",
  description: "A pixel pet with a private AI brain. Every reply is paid from its own NEAR wallet; the web app is its console.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pixel.variable} ${figtree.variable} ${dmMono.variable}`}>
      <body className="min-h-dvh bg-bg text-ink antialiased"><Providers><SiteHeader />{children}</Providers></body>
    </html>
  );
}
