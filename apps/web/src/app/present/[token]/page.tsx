import type { Metadata } from "next";
import { Projector } from "@/components/projector/Projector";

export const metadata: Metadata = { title: "Projector", robots: { index: false } };

export default async function Page({ params }: PageProps<"/present/[token]">) {
  const { token } = await params;
  return <Projector token={token} />;
}
