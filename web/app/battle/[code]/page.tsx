import { notFound } from "next/navigation";
import { BattleRoom } from "@/components/battle/BattleRoom";
import { normalizeCode } from "@/lib/battle";

// /battle/[code] (spec 3.3): waiting room, the battle, the result.
export default async function BattleRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = normalizeCode(decodeURIComponent(code));
  if (clean.length !== 6) notFound();
  return <BattleRoom code={clean} />;
}
