import { brand } from "@crowdquiz/shared";

/**
 * Details shown on the privacy policy, terms and support pages. Set these on
 * the website before the app is submitted (see docs/app-store.md).
 */
export const legal = {
  /** The person or company that runs the service. */
  operator: process.env.NEXT_PUBLIC_OPERATOR_NAME ?? "the operator of this service",
  /** An inbox you read. Apple and your users will use it. */
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? brand.supportEmail,
  /** Postal address, if you want to publish one (optional). */
  address: process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? "",
  /** The app's store name. The website keeps its own brand. */
  appName: "Buzzavid",
  updated: "23 October 2026",
};
