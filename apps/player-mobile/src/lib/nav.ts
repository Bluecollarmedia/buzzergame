import type { ComponentProps } from "react";
import type { Stack } from "expo-router";
import { colors } from "./theme";

/**
 * Native navigation bars. They are transparent with large titles, which is
 * how iOS 26 draws them as Liquid Glass that blends into the content.
 */
type StackOptions = Extract<ComponentProps<typeof Stack>["screenOptions"], object>;

export const stackOptions: StackOptions = {
  headerTransparent: true,
  headerLargeTitle: true,
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
  headerTintColor: colors.text,
  headerTitleStyle: { color: colors.text },
  headerLargeTitleStyle: { color: colors.text },
  contentStyle: { backgroundColor: colors.stage },
};
