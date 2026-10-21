import type { Metadata } from "next";
import { QuizLibrary } from "@/components/host/QuizLibrary";

export const metadata: Metadata = { title: "Quizzes" };

export default function Page() {
  return <QuizLibrary />;
}
