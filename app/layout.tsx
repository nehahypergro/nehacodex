import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creative AI - Video",
  description: "Generate multi-model short-form video creatives from single or bulk inputs"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
