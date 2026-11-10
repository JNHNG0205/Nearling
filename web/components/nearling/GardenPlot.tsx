// A pixel seedling in a soil plot (GardenPlot, design.md section 5). 16x16 grid drawn as square rects.

const ROWS = [
  "......LL........",
  ".....LLLL..LL...",
  "....LLLLL.LLLL..",
  "....LLLLLLLLLL..",
  ".....LLLSLLLL...",
  ".......S........",
  ".......S........",
  ".......S........",
  ".......S........",
  ".GGGGGGGGGGGGGG.",
  "GDDDDDDDDDDDDDDG",
  "GDdDDDdDDDDdDDDG",
  "GDDDDDDDDdDDDDDG",
  "GDDdDDDDDDDDDdDG",
  "GDDDDDDdDDDDDDDG",
  ".GGGGGGGGGGGGGG.",
];

const COLOUR: Record<string, string> = {
  L: "var(--n-fuel)", S: "#5f8f3e", G: "var(--n-line)", D: "#3b2a1c", d: "var(--p-accent)",
};

export function GardenPlot({ size = 192 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" role="img"
      aria-label="A seedling growing in the Brain Garden">
      {ROWS.flatMap((row, y) =>
        [...row].map((ch, x) => (COLOUR[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLOUR[ch]} /> : null)),
      )}
    </svg>
  );
}
