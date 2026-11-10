import { notFound } from "next/navigation";
import { RaceRoom } from "@/components/race/RaceRoom";
import { normalizeCode } from "@/lib/race";

// /race/[code] (03-pages-and-flows.md section 11): lobby, countdown, race, result.
export default async function RaceRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = normalizeCode(decodeURIComponent(code));
  if (clean.length !== 6) notFound();
  return <RaceRoom code={clean} />;
}
