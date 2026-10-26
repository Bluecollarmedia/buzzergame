import { Stack } from "expo-router";
import { stackOptions } from "@/lib/nav";

export default function AdminLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" options={{ title: "Admin" }} />
    </Stack>
  );
}
