import type { Metadata } from "next";
import { QuizEditor } from "@/components/host/editor/QuizEditor";

export const metadata: Metadata = { title: "Edit quiz" };

export default async function Page({ params }: PageProps<"/quizzes/[id]">) {
  const { id } = await params;
  return <QuizEditor quizId={id} />;
}
