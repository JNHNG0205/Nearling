import type { Metadata } from "next";
import { ReceiptView } from "@/components/talk/ReceiptView";

export const metadata: Metadata = { title: "Reply receipt . Petto" };

export default async function ReceiptPage({ params }: { params: Promise<{ turnId: string }> }) {
  const { turnId } = await params;
  return <ReceiptView turnId={decodeURIComponent(turnId)} />;
}
