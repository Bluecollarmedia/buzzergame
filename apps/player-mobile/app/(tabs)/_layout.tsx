import { NativeTabs } from "expo-router/unstable-native-tabs";
import { colors } from "@/lib/theme";
import { useIsAdmin } from "@/lib/useIsAdmin";

/**
 * The tab bar is the system's own. On iOS 26 and later that is Apple's Liquid
 * Glass tab bar, which also shrinks as you scroll; on Android it is the Material bar.
 */
export default function TabsLayout() {
  const isAdmin = useIsAdmin();
  return (
    <NativeTabs tintColor={colors.primary} minimizeBehavior="onScrollDown" labelStyle={{ color: colors.muted }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Play</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "bolt", selected: "bolt.fill" }} md="bolt" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="host">
        <NativeTabs.Trigger.Label>Host</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "rectangle.stack", selected: "rectangle.stack.fill" }} md="library_books" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="admin" hidden={!isAdmin}>
        <NativeTabs.Trigger.Label>Admin</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "shield", selected: "shield.fill" }} md="shield" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }} md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
