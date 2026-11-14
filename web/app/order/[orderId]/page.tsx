"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RoomQr } from "@/components/battle/RoomQr";
import { getOrder, toMs, type Order, type OrderStatus } from "@/components/wallet/brainApi";
import { AppFrame, ErrorText, Panel, Spinner, TxLink } from "@/components/wallet/ui";
import { BrainRequestError } from "@/lib/brain";
import { petFromRef } from "@/lib/chain";

// /order/[orderId] (03 section 4). Refresh-safe: it only reads the order status, never feeds.

const TERMINAL: OrderStatus[] = ["fed", "failed", "refunded", "expired"];

const COPY: Record<OrderStatus, { title: string; body: string }> = {
  created: { title: "Payment pending", body: "Waiting for your payment." },
  quoted: { title: "Payment pending", body: "Send the exact amount below before the deadline." },
  pending: { title: "Payment seen", body: "Confirming your payment." },
  settled: { title: "Paid", body: "Feeding now." },
  feeding: { title: "Feeding", body: "The fuel is on its way to the pet on NEAR testnet." },
  fed: { title: "Fed", body: "The pet has new fuel." },
  failed: { title: "Payment failed", body: "No fuel was added. Please try again." },
  refunded: { title: "Refunded", body: "Your payment was sent back. No fuel was added." },
  expired: { title: "Quote expired", body: "The deadline passed before a payment arrived. Get a new quote." },
};

export default function OrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let timer = 0;
    const poll = async () => {
      try {
        const o = await getOrder(orderId);
        if (!live) return;
        setOrder(o);
        setError(null);
        if (TERMINAL.includes(o.status)) return;
      } catch (err) {
        if (!live) return;
        if (err instanceof BrainRequestError && err.status === 404) {
          setError("We couldn't find this order.");
          return;
        }
        setError("Couldn't reach the brain. Retrying...");
      }
      timer = window.setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [orderId]);

  if (!order) {
    return (
      <AppFrame title="Your order">
        {error ? <ErrorText>{error}</ErrorText> : <Spinner />}
      </AppFrame>
    );
  }

  const copy = COPY[order.status] ?? COPY.created;
  const pet = petFromRef(order.pet_ref);
  const feedHref = pet ? `/feed/${encodeURIComponent(pet.ref)}` : "/";

  return (
    <AppFrame title={copy.title} back={feedHref}>
      <Panel>
        {order.mode === "live" && <p className="text-sm text-warn">Paid on mainnet, fuel granted on testnet.</p>}
        <p>{copy.body}</p>
        {order.status === "fed" && (
          <p className="font-display text-2xl text-fuel">
            +{order.fuel ?? "new"} thoughts
          </p>
        )}
        {order.feed_tx && (
          <p className="text-sm">
            Feed transaction <TxLink hash={order.feed_tx} />
          </p>
        )}
        {!TERMINAL.includes(order.status) && <Spinner label="Checking..." />}
        <ErrorText>{error}</ErrorText>
      </Panel>

      {order.mode === "live" && order.deposit_address && (order.status === "quoted" || order.status === "created") && (
        <LiveDeposit order={order} />
      )}

      {pet && order.status === "fed" && (
        <Link className="pixel-btn" href={`/pet/${encodeURIComponent(pet.ref)}`}>
          See your pet
        </Link>
      )}
      {(order.status === "expired" || order.status === "failed" || order.status === "refunded") && (
        <Link className="pixel-btn" href={feedHref}>
          Get a new quote
        </Link>
      )}
    </AppFrame>
  );
}

function LiveDeposit({ order }: { order: Order }) {
  const deadline = toMs(order.deadline ?? order.quote?.deadline); // brain sends deadline at top level
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = deadline ? Math.max(0, Math.floor((deadline - now) / 1000)) : null;

  return (
    <Panel>
      <h2 className="font-display text-lg">Send exactly</h2>
      <p className="font-mono">
        {order.quote?.amount_in_formatted ?? order.quote?.amount_in} {order.quote?.origin_asset}
      </p>
      <p className="text-sm text-muted">to this deposit address</p>
      {order.deposit_address && (
        <div className="self-center">
          <RoomQr url={order.deposit_address} size={200} />
        </div>
      )}
      <p className="break-all font-mono text-sm">{order.deposit_address}</p>
      <button
        className="pixel-btn pixel-btn--secondary"
        onClick={() => {
          void navigator.clipboard.writeText(order.deposit_address ?? "").then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy the address"}
      </button>
      {left !== null && (
        <p className="font-mono text-sm">
          Quote ends in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </p>
      )}
    </Panel>
  );
}
