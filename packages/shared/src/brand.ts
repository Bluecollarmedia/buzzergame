/**
 * Central brand settings. Change the product name, colours and buzzer
 * mapping here; the web app, projector and native app all read from this file.
 */
export const brand = {
  productName: "CrowdQuiz",
  tagline: "Live quiz games where every phone is a buzzer.",
  /** Shown in the browser tab and app store listings. */
  shortDescription: "Host live trivia on a projector. Players answer on their phones.",
  supportEmail: "support@example.com",
  colors: {
    /** Primary accent used for actions and focus rings. */
    primary: "#4F46E5",
    primaryHover: "#4338CA",
    primaryContrast: "#FFFFFF",
    ink: "#0F172A",
    inkMuted: "#475569",
    surface: "#FFFFFF",
    surfaceMuted: "#F8FAFC",
    border: "#E2E8F0",
    success: "#16A34A",
    danger: "#DC2626",
    warning: "#D97706",
    /** Projector background. */
    stage: "#0B1020",
    stageRaised: "#141B33",
  },
  typography: {
    /** Loaded by the web app via next/font; native falls back to the system font. */
    fontFamily: "Inter",
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24 },
} as const;

export type ChoiceIndex = 0 | 1 | 2 | 3;

export const CHOICE_LABELS = ["A", "B", "C", "D"] as const;

/**
 * The four answer colours. Used for both game modes so A/B/C/D always look
 * the same on the projector and on phones. Colour Buzzer depends on this
 * exact mapping: Red = A, Blue = B, Green = C, Purple = D.
 */
export const ANSWER_COLORS: ReadonlyArray<{
  index: ChoiceIndex;
  label: (typeof CHOICE_LABELS)[number];
  name: string;
  /** Button background. All have >= 4.5:1 contrast with white text. */
  bg: string;
  /** Pressed / darker variant. */
  bgPressed: string;
  /** Light tint for backgrounds. */
  tint: string;
  text: string;
}> = [
  { index: 0, label: "A", name: "Red", bg: "#D92D20", bgPressed: "#B42318", tint: "#FEE4E2", text: "#FFFFFF" },
  { index: 1, label: "B", name: "Blue", bg: "#1D4ED8", bgPressed: "#1E40AF", tint: "#DBEAFE", text: "#FFFFFF" },
  { index: 2, label: "C", name: "Green", bg: "#067647", bgPressed: "#05603A", tint: "#D1FADF", text: "#FFFFFF" },
  { index: 3, label: "D", name: "Purple", bg: "#7A2EC7", bgPressed: "#6222A3", tint: "#F0E5FF", text: "#FFFFFF" },
];

export function answerColor(index: number) {
  const c = ANSWER_COLORS[index];
  if (!c) throw new Error(`Invalid choice index ${index}`);
  return c;
}
