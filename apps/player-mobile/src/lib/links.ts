import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";
import { SUPPORT_EMAIL, WHATSAPP_ACCESS_MESSAGE, WHATSAPP_NUMBER, links } from "./brand";

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

/**
 * Opens a WhatsApp chat with the owner, with the access request already typed.
 * A wa.me https link opens the WhatsApp app when it's installed and the
 * WhatsApp website otherwise, so no native setup is needed.
 */
export function messageOnWhatsApp(text = WHATSAPP_ACCESS_MESSAGE) {
  return Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`);
}
