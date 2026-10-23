import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";
import { SUPPORT_EMAIL, links } from "./brand";

/** Opens a page of the website inside the app (Safari view controller). */
export async function openPage(kind: "privacy" | "terms" | "support") {
  const url = links[kind];
  if (!url) return;
  try {
    await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET, controlsColor: "#7C5CFF" });
  } catch {
    void Linking.openURL(url);
  }
}

export function emailSupport(subject = "Buzzavid support") {
  if (!SUPPORT_EMAIL) return openPage("support");
  return Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`);
}
