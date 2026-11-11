"use client";

import { useEffect, useState } from "react";
import { BRAIN_URL } from "@/lib/brain";

/** `GET /pets/:petRef/metadata` (AI-brain 08): the pet's public metadata pinned to IPFS. */
interface PetMetadataInfo {
  json_cid: string;
  png_cid: string;
  gateway_url: string;
  image_url: string;
  pinned_at: number;
  on_chain: boolean;
}

const short = (cid: string) => (cid.length > 14 ? `${cid.slice(0, 8)}...${cid.slice(-4)}` : cid);

/** A small "On IPFS" line with the JSON and image links. Renders nothing until the brain has pinned the pet. */
export function IpfsLinks({ petRef }: { petRef: string }) {
  const [info, setInfo] = useState<PetMetadataInfo | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${BRAIN_URL}/pets/${encodeURIComponent(petRef)}/metadata`)
      .then((r) => (r.ok ? (r.json() as Promise<PetMetadataInfo>) : null))
      .then((m) => live && setInfo(m))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [petRef]);

  if (!info) return null;
  const link = "font-mono text-accent underline underline-offset-4";
  return (
    <p className="text-sm text-muted">
      On IPFS:{" "}
      <a className={link} href={info.gateway_url} target="_blank" rel="noreferrer" title={info.json_cid}>
        metadata {short(info.json_cid)}
      </a>{" "}
      .{" "}
      <a className={link} href={info.image_url} target="_blank" rel="noreferrer" title={info.png_cid}>
        image {short(info.png_cid)}
      </a>
      {info.on_chain ? " . linked from the NFT" : ""}
    </p>
  );
}
