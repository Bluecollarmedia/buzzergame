import type { Metadata } from "next";
import { HostControl } from "@/components/host/session/HostControl";

export const metadata: Metadata = { title: "Game controls" };

export default async function Page({ params }: PageProps<"/sessions/[id]/host">) {
  const { id } = await params;
  return <HostControl sessionId={id} />;
}
