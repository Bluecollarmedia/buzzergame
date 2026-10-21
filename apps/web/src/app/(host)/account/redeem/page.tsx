import type { Metadata } from "next";
import { RedeemCode } from "@/components/account/RedeemCode";

export const metadata: Metadata = { title: "Redeem access code" };

export default function Page() {
  return <RedeemCode />;
}
