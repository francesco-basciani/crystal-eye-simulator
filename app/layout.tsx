import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const publicOrigin = isGitHubPages
  ? "https://francesco-basciani.github.io/crystal-eye-simulator"
  : "https://crystal-eye-orbit-sim.francesco-basciani.chatgpt.site";
const imageUrl = `${publicOrigin}/og-v2.png`;
const title = "Crystal Eye · Orbital Photon Simulator";
const description =
  "Digital twin interattivo per simulare l’orbita LEO del Crystal Eye, il background dinamico e la cattura di fotoni gamma.";

export const metadata: Metadata = {
  title,
  description,
  icons: {
    icon: `${publicBasePath}/favicon.svg`,
    shortcut: `${publicBasePath}/favicon.svg`,
  },
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: imageUrl, width: 1536, height: 1024, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [imageUrl],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
