import type { Metadata } from "next";
import { Dashboard } from "@/components/host/Dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return <Dashboard />;
}
