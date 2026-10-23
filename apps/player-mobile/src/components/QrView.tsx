import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import QRCode from "qrcode";

/** A QR code drawn as native vector shapes. High error correction so it scans from a distance. */
export function QrView({ value, size = 220 }: { value: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const out: Array<[number, number]> = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) out.push([x, y]);
    return { n, out };
  }, [value]);
  const quiet = 2;
  const total = cells.n + quiet * 2;
  return (
    <View accessibilityRole="image" accessibilityLabel="QR code to join the game" style={{ width: size, height: size, backgroundColor: "white", borderRadius: 20, padding: 0, overflow: "hidden" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`}>
        <Rect x={0} y={0} width={total} height={total} fill="white" />
        {cells.out.map(([x, y]) => (
          <Rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width={1.02} height={1.02} fill="#0b1020" />
        ))}
      </Svg>
    </View>
  );
}
