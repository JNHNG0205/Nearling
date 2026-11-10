import Link from "next/link";

// Landing, section 1 of design.md 6.1. The live demo pet frame lands with the sprite renderer.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[1200px] flex-col justify-center gap-8 px-4 md:px-6">
      <p className="font-display text-2xl text-accent">Nearling</p>
      <h1 className="font-display text-[32px] leading-9 font-semibold md:text-[40px] md:leading-[44px]">
        Nearling, a pixel pet that pays for its own AI
      </h1>
      <p className="max-w-xl text-muted">
        Every reply costs $0.001 of private AI, paid from the pet&apos;s own NEAR budget on testnet.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link href="/adopt" className="pixel-btn">Hatch a pet</Link>
        <Link href="/pet/pets-demo.nearling.testnet%3A0" className="pixel-btn pixel-btn--secondary">
          Watch the demo pet
        </Link>
      </div>
    </main>
  );
}
