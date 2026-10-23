import { Stack } from "expo-router";
import { stackOptions } from "@/lib/nav";

export default function AccountLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" options={{ title: "Account" }} />
    </Stack>
  );
}
