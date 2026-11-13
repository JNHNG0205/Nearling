import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptList } from "@/components/talk/ReceiptList";

export const metadata: Metadata = { title: "Receipts . Petto" };

export default async function ReceiptsPage({ params }: { params: Promise<{ petRef: string }> }) {
  const { petRef } = await params;
  const ref = decodeURIComponent(petRef);
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3">
        <Link href={`/pet/${encodeURIComponent(ref)}`} className="pixel-btn pixel-btn--secondary px-3" aria-label="Back">&lt;</Link>
        <h1 className="font-display text-2xl">Receipts</h1>
      </header>
      <p className="text-muted">Every reply is one thought of fuel and comes with proof of where it ran.</p>
      <ReceiptList petRef={ref} />
    </main>
  );
}
