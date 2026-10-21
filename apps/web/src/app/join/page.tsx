import type { Metadata } from "next";
import { JoinByCode } from "@/components/player/JoinByCode";

export const metadata: Metadata = { title: "Join a game" };

export default function Page() {
  return <JoinByCode />;
}
