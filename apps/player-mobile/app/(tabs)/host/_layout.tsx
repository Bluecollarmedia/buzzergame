import { Stack } from "expo-router";
import { stackOptions } from "@/lib/nav";

export default function HostLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" options={{ title: "Host" }} />
      <Stack.Screen name="new" options={{ title: "New quiz", headerLargeTitle: false, presentation: "modal" }} />
      <Stack.Screen name="quiz/[id]" options={{ title: "Quiz", headerLargeTitle: false }} />
    </Stack>
  );
}
