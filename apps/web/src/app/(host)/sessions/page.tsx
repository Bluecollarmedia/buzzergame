import type { Metadata } from "next";
import { SessionList } from "@/components/host/session/SessionList";

export const metadata: Metadata = { title: "Games" };

export default function Page() {
  return <SessionList />;
}
