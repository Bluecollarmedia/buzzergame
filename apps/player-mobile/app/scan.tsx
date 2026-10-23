import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Keyboard, X } from "lucide-react-native";
import { errorMessage, parseJoinInput } from "@crowdquiz/shared";
import { Glass } from "@/components/glass";
import { Button, Center, Screen, styles } from "@/components/ui";
import { allowedJoinHosts } from "@/lib/config";
import { feel } from "@/lib/haptics";
import { getApi } from "@/lib/supabase";
import { colors, radius, space } from "@/lib/theme";

/**
 * QR scanner. Camera permission is only requested when the player taps
 * "Allow camera", and typing the room code is always available instead.
 */
export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const handling = useRef(false);

  const onScan = async ({ data }: BarcodeScanningResult) => {
    if (handling.current) return;
    handling.current = true;
    const parsed = parseJoinInput(data, allowedJoinHosts());
    try {
      if (parsed.kind === "token") {
        feel.joined();
        router.replace({ pathname: "/j/[token]", params: { token: parsed.joinToken } });
        return;
      }
      if (parsed.kind === "room") {
        const r = await getApi().resolveRoomCode(parsed.roomCode);
        feel.joined();
        router.replace({ pathname: "/j/[token]", params: { token: r.joinToken } });
        return;
      }
      feel.wrong();
      setMessage("That QR code isn't a Buzzavid game.");
    } catch (e) {
      setMessage(errorMessage(e));
    }
    setTimeout(() => {
      handling.current = false;
    }, 1500);
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  if (!permission) return <Screen />;

  if (!permission.granted) {
    return (
      <Screen>
        <Center>
          <Text style={styles.title}>Scan the QR code</Text>
          <Text style={[styles.body, { marginTop: 12, textAlign: "center" }]}>
            Buzzavid uses the camera only to read the game&apos;s QR code. Nothing is recorded or saved.
          </Text>
          <View style={{ alignSelf: "stretch", gap: space.md, marginTop: 28 }}>
            {permission.canAskAgain ? (
              <Button title="Allow camera" onPress={requestPermission} />
            ) : (
              <Text style={[styles.body, { color: colors.warn, textAlign: "center" }]}>
                Camera access is off for Buzzavid. Turn it on in Settings, or type the room code instead.
              </Text>
            )}
            <Button title="Type the room code" variant="glass" onPress={close} icon={<Keyboard color={colors.text} size={20} />} />
          </View>
        </Center>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScan} />
      <Screen style={{ backgroundColor: "transparent" }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingTop: 8 }}>
          <Button title="Close" variant="glass" small onPress={close} icon={<X color={colors.text} size={18} />} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View style={local.frame} accessibilityLabel="Point the camera at the QR code" />
        </View>
        <View style={{ paddingBottom: 24, gap: space.md }}>
          {message && (
            <Glass tint={colors.danger} radiusSize={radius.md} style={{ padding: space.md }}>
              <Text style={[styles.body, { color: colors.text, textAlign: "center" }]} accessibilityRole="alert">{message}</Text>
            </Glass>
          )}
          <Glass radiusSize={radius.md} style={{ padding: space.md }}>
            <Text style={[styles.body, { textAlign: "center", color: colors.text }]}>Point your camera at the QR code on the big screen.</Text>
          </Glass>
        </View>
      </Screen>
    </View>
  );
}

const local = StyleSheet.create({
  frame: { width: 260, height: 260, borderRadius: 36, borderWidth: 4, borderColor: "rgba(255,255,255,0.92)" },
});
