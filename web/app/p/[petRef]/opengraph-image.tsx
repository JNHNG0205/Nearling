import { ImageResponse } from "next/og";
import { thoughts } from "@/components/FuelMeter";
import { petPng } from "@/components/nearling/petPng";
import { getPetState } from "@/lib/brain";

export const revalidate = 30;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A Petto pixel pet";

const BG = "#0c0a08";
const INK = "#ffffff";
const MUTED = "#8f8a84";
const ACCENT = "#c9a45a";
const SCREEN = "#0f140c";
const BEZEL = "#231f1a";
const LINE = "#3a332b";

// OG image for the public pet page (03-pages section 12): the pet's own pixels, name, stage, fuel.
export default async function Image({ params }: { params: Promise<{ petRef: string }> }) {
  const ref = decodeURIComponent((await params).petRef);
  const pet = await getPetState(ref, { next: { revalidate: 30 } }).catch(() => null);

  const sprite = pet
    ? petPng({ traits: pet.traits, stageIndex: pet.stage_index, winged: pet.form === "winged", state: pet.display_state, scale: 10 })
    : petPng({ traits: [2, 0, 1, 0, 0], stageIndex: 0, winged: false, state: "happy", scale: 10 });
  const src = `data:image/png;base64,${sprite.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", background: BG, padding: 64, gap: 64 }}>
        <div style={{ display: "flex", padding: 24, background: BEZEL, border: `4px solid ${LINE}`, boxShadow: "8px 8px 0 #000" }}>
          <div style={{ display: "flex", width: 400, height: 400, alignItems: "center", justifyContent: "center", background: SCREEN, border: "4px solid #000" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} width={320} height={320} alt="" style={{ imageRendering: "pixelated" }} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, color: INK, flex: 1 }}>
          <div style={{ fontSize: 32, color: ACCENT }}>Petto</div>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1 }}>{pet?.name ?? "A Petto"}</div>
          <div style={{ fontSize: 40, color: MUTED }}>
            {pet ? `${pet.stage}${pet.form === "winged" ? " . winged" : ""}` : "pixel pet on NEAR"}
          </div>
          {pet && (
            <div style={{ display: "flex", fontSize: 40, color: pet.fuel.low ? "#e8913a" : "#9ad46a" }}>
              {thoughts(pet.fuel.left)} left
            </div>
          )}
          {pet?.demo_speed && (
            <div style={{ display: "flex", fontSize: 28, color: ACCENT, border: `3px solid ${ACCENT}`, padding: "4px 12px", alignSelf: "flex-start" }}>
              demo speed
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
