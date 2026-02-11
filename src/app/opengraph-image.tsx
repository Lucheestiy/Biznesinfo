import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 72,
          background: "linear-gradient(135deg, #b10a78 0%, #7a0150 55%, #4a0132 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "rgba(255,255,255,0.16)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
              lineHeight: 1,
            }}
          >
            🏢
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: -0.8,
            }}
          >
            Biznesinfo
          </div>
        </div>

        <div
          style={{
            maxWidth: 980,
            fontSize: 34,
            lineHeight: 1.25,
            color: "rgba(255,255,255,0.92)",
          }}
        >
          Бизнес-справочник Беларуси: компании, товары и услуги
        </div>

        <div
          style={{
            marginTop: 26,
            fontSize: 22,
            color: "rgba(255,255,255,0.75)",
          }}
        >
          biznesinfo.lucheestiy.com
        </div>
      </div>
    ),
    size,
  );
}

