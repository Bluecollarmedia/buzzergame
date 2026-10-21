import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Keyboard, X } from "lucide-react-native";
import { errorMessage, parseJoinInput } from "@crowdquiz/shared";
import { Button, Center, Screen, styles } from "@/components/ui";
import { allowedJoinHosts } from "@/lib/config";
import { getApi } from "@/lib/supabase";
import { colors } from "@/lib/theme";

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
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace({ pathname: "/j/[token]", params: { token: parsed.joinToken } });
        return;
      }
      if (parsed.kind === "room") {
        const r = await getApi().resolveRoomCode(parsed.roomCode);
        router.replace({ pathname: "/j/[token]", params: { token: r.joinToken } });
        return;
      }
      setMessage("That QR code isn't a CrowdQuiz game.");
    } catch (e) {
      setMessage(errorMessage(e));
    }
    // Let the player try again after a moment.
    setTimeout(() => {
      handling.current = false;
    }, 1500);
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  if (!permission) {
    return <Screen />;
  }

  if (!permission.granted) {
    return (
      <Screen>
        <Center>
          <Text style={styles.big}>Scan the QR code</Text>
          <Text style={[styles.body, { marginTop: 12 }]}>
            CrowdQuiz uses the camera only to read the game&apos;s QR code. Nothing is recorded.
          </Text>
          <View style={{ alignSelf: "stretch", gap: 12, marginTop: 28 }}>
            {permission.canAskAgain ? (
              <Button title="Allow camera" onPress={requestPermission} />
            ) : (
              <Text style={[styles.body, { color: colors.warn }]}>
                Camera access is turned off for CrowdQuiz. You can turn it on in Settings, or type the room code instead.
              </Text>
            )}
            <Button title="Type the room code" variant="secondary" onPress={close} icon={<Keyboard color={colors.text} size={20} />} />
          </View>
        </Center>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onScan}
      />
      <Screen style={{ backgroundColor: "transparent" }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingTop: 8 }}>
          <Button title="Close" variant="ghost" onPress={close} icon={<X color={colors.text} size={20} />} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View style={local.frame} accessibilityLabel="Point the camera at the QR code" />
        </View>
        <View style={{ paddingBottom: 24, gap: 12 }}>
          {message && (
            <Text style={[styles.error, local.pill]} accessibilityRole="alert">
              {message}
            </Text>
          )}
          <Text style={[styles.body, local.pill]}>Point your camera at the QR code on the big screen.</Text>
        </View>
      </Screen>
    </View>
  );
}

const local = StyleSheet.create({
  frame: { width: 250, height: 250, borderRadius: 24, borderWidth: 4, borderColor: "rgba(255,255,255,0.9)" },
  pill: { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, padding: 12, overflow: "hidden", textAlign: "center" },
});
