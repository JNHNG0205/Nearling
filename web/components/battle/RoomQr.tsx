"use client";

import qrcode from "qrcode-generator";

/** Square-module QR as an SVG (pixel look, no blur). Dark modules on white for phone cameras. */
export function RoomQr({ url, size = 160 }: { url: string; size?: number }) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const cells: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
  }
  const box = n + quiet * 2;
  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${url}`}
      className="border-2 border-[var(--n-shadow)] bg-[var(--p-inv-bg)]"
    >
      <path d={cells.join("")} fill="var(--p-inv-ink)" />
    </svg>
  );
}
