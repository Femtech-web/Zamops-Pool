import { ImageResponse } from "next/og";

export const alt = "ZamOps Pool — confidential prize savings";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "74px 82px", background: "#171815", color: "#f2efe7", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 28, fontWeight: 700 }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "#f8df75", color: "#151515" }}>Z</div>
        ZamOps / Pool
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        <div style={{ maxWidth: 980, fontSize: 82, lineHeight: 1.02, letterSpacing: "-0.055em" }}>Private savings. Fair chances. Protected principal.</div>
        <div style={{ color: "#aaa397", fontSize: 25 }}>Confidential prize savings powered by Zama FHEVM.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#86c99f", fontSize: 20 }}><span style={{ width: 9, height: 9, borderRadius: 99, background: "#86c99f" }} /> Ethereum Sepolia</div>
    </div>,
    size,
  );
}
