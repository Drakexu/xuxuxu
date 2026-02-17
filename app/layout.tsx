import type { Metadata } from "next";
import { Cormorant_Garamond, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

const uiSans = Manrope({
  variable: "--font-ui-sans",
  subsets: ["latin"],
});

const uiMono = JetBrains_Mono({
  variable: "--font-ui-mono",
  subsets: ["latin"],
});

const uiDisplay = Cormorant_Garamond({
  variable: "--font-ui-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const bodyClassName = [
  uiSans.variable,
  uiMono.variable,
  uiDisplay.variable,
  "antialiased",
].join(" ");

export const metadata: Metadata = {
  title: "XuxuXu AI",
  description: "Immersive AI character chat on the web.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={bodyClassName}>{children}</body>
    </html>
  );
}
