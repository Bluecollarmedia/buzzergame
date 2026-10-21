import type { Metadata, Viewport } from "next";
import { PlayerApp } from "@/components/player/PlayerApp";

export const metadata: Metadata = { title: "Play", robots: { index: false } };
export const viewport: Viewport = { themeColor: "#0b1020", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default async function Page({ params }: PageProps<"/j/[token]">) {
  const { token } = await params;
  return <PlayerApp joinToken={token} />;
}
