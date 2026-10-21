import { Suspense } from "react";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
