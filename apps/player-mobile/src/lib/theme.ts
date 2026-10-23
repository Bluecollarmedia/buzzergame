import { ANSWER_COLORS } from "@crowdquiz/shared";

/** One dark theme for the whole app: the game is played in dim rooms. */
export const colors = {
  stage: "#080B18",
  stageRaised: "#10152B",
  glass: "rgba(255,255,255,0.08)",
  glassStrong: "rgba(255,255,255,0.14)",
  border: "rgba(255,255,255,0.14)",
  text: "#FFFFFF",
  muted: "rgba(255,255,255,0.68)",
  subtle: "rgba(255,255,255,0.46)",
  primary: "#7C5CFF",
  primarySoft: "rgba(124,92,255,0.22)",
  accent: "#FF4FA3",
  good: "#34D399",
  bad: "#FB7185",
  warn: "#FBBF24",
  gold: "#FBBF24",
  danger: "#F43F5E",
};

export const radius = { sm: 10, md: 16, lg: 22, xl: 30, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const font = {
  title: { fontSize: 34, fontWeight: "800" as const, letterSpacing: -0.5 },
  h1: { fontSize: 28, fontWeight: "800" as const, letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: "700" as const },
  body: { fontSize: 16, fontWeight: "500" as const },
  small: { fontSize: 13, fontWeight: "500" as const },
  label: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 1.4, textTransform: "uppercase" as const },
};

export { ANSWER_COLORS };
