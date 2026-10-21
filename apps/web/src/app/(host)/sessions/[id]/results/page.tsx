import type { Metadata } from "next";
import { SessionResultsView } from "@/components/host/session/SessionResults";

export const metadata: Metadata = { title: "Results" };

export default async function Page({ params }: PageProps<"/sessions/[id]/results">) {
  const { id } = await params;
  return <SessionResultsView sessionId={id} />;
}
