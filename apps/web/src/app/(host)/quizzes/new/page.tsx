import type { Metadata } from "next";
import { NewQuiz } from "@/components/host/NewQuiz";

export const metadata: Metadata = { title: "Create a game" };

export default function Page() {
  return <NewQuiz />;
}
