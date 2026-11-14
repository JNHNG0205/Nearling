"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PixelIcon, type IconName } from "@/components/PixelIcon";

/**
 * One bar for a pet's pages: the everyday ones as tabs (current one highlighted, scrolls sideways
 * on phones), the rare ones under "More". Used on the pet home and every pet sub-page.
 */
export function PetTabs({ petRef, isOwner }: { petRef: string; isOwner: boolean }) {
  const path = usePathname();
  const ref = encodeURIComponent(petRef);
  const tabs: [string, string, IconName][] = [
    [`/pet/${ref}`, "Talk", "talk"],
    [`/feed/${ref}`, "Feed", "feed"],
    [`/pet/${ref}/garden`, "Garden", "garden"],
    [`/pet/${ref}/closet`, "Closet", "closet"],
    [`/pet/${ref}/soul`, "Soul", "soul"],
    [`/pet/${ref}/traits`, "Traits", "traits"],
    [`/pet/${ref}/device`, "Device", "device"],
  ];
  const more: [string, string][] = [
    [`/pet/${ref}/receipts`, "Receipts"],
    [`/p/${ref}`, "Share"],
    ["/battle", "Battle"],
    ...(isOwner ? ([[`/pet/${ref}/settings`, "Settings"], [`/pet/${ref}/transfer`, "Give away"]] as [string, string][]) : []),
  ];
  const here = (href: string) => decodeURIComponent(path ?? "") === decodeURIComponent(href);

  return (
    <nav aria-label="Pet pages" className="flex items-stretch gap-2 border-b-2 border-line">
      <ul className="-mb-[2px] flex min-w-0 flex-1 gap-1 overflow-x-auto font-display text-sm">
        {tabs.map(([href, label, icon]) => (
          <li key={href} className="shrink-0">
            <Link
              href={href}
              aria-current={here(href) ? "page" : undefined}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 ${here(href) ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
            >
              <PixelIcon name={icon} size={14} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <details className="relative shrink-0 font-display text-sm">
        <summary className="cursor-pointer list-none px-3 py-2 text-muted hover:text-ink" aria-label="More pet pages">
          More
        </summary>
        <ul className="pixel-panel absolute right-0 z-20 mt-1 flex w-44 flex-col bg-bg p-1">
          {more.map(([href, label]) => (
            <li key={href}>
              <Link href={href} className="block px-3 py-2 hover:bg-surface">{label}</Link>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
