/** Names and links used in the app. The website keeps its own brand. */
export const APP_NAME = "Buzzavid";
export const APP_TAGLINE = "Every phone is a buzzer.";

const site = (process.env.EXPO_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
export const links = {
  site,
  privacy: site ? `${site}/privacy` : "",
  terms: site ? `${site}/terms` : "",
  support: site ? `${site}/support` : "",
};
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? "";
