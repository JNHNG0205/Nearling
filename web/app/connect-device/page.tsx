import Link from "next/link";
import { AppFrame } from "@/components/wallet/ui";

export const metadata = { title: "Connect your Petto device" };

// Step-by-step guide for pairing the hardware Petto (Build Spec: Wi-Fi setup page, QR or Bluetooth,
// physical button press, then the device key on the pet's Device page). docs/hardware/DEVICE_PROTOCOL.md.
const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Power it on",
    body: "Plug your Petto into USB power. After a few seconds the screen lights up and shows that it needs Wi-Fi.",
  },
  {
    title: "Join it to Wi-Fi",
    body: (
      <>
        On your phone, open Wi-Fi settings and join the network your Petto shows on screen. A setup page opens; if it
        does not, open the address shown on the Petto in your browser. Pick your home Wi-Fi, type its password and save.
        The password stays on the device.
      </>
    ),
  },
  {
    title: "Get the pairing code",
    body: "Once online, your Petto shows a QR code. It is a one-time link, valid for a few minutes. If it expires, press the button to show a new one.",
  },
  {
    title: "Open the link",
    body: (
      <>
        <strong>Phone:</strong> scan the QR with your camera. <strong>Computer or Android with Chrome or Edge:</strong>{" "}
        you can instead use <em>Find my Petto</em> on the setup page, which reads the link over Bluetooth (its name
        starts with <code>Nearling-</code>). iPhone and Safari: use the QR.
      </>
    ),
  },
  {
    title: "Connect your wallet and pick a pet",
    body: "The link opens the setup page. Connect your NEAR testnet wallet (Meteor works best), then choose one of your pets or hatch a new one.",
  },
  {
    title: "Confirm on the device",
    body: "Your Petto asks you to confirm. Press its button. This proves the device is really in your hands, so nobody can pair from afar.",
  },
  {
    title: "Give your Petto its key (optional)",
    body: (
      <>
        On the pet&apos;s <em>Device</em> page, press <em>Give your Petto its key</em> and approve once in your wallet.
        The key is a limited key: the device can pat, feed from the pantry you stock, and approve actions, but it can
        never send your NEAR anywhere else.
      </>
    ),
  },
];

export default function ConnectDevicePage() {
  return (
    <AppFrame title="Connect your Petto" back="/start">
      <p className="text-muted">
        Takes about two minutes. You need the Petto, a phone or computer, and a NEAR testnet wallet.
      </p>
      <ol className="flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="pixel-panel flex flex-col gap-2 p-4">
            <h2 className="font-display text-lg">
              <span className="text-accent">{i + 1}.</span> {s.title}
            </h2>
            <p className="text-sm text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <section className="pixel-panel flex flex-col gap-2 p-4">
        <h2 className="font-display text-lg">Stuck?</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          <li>No QR on screen: check the Wi-Fi password, then restart the Petto.</li>
          <li>&quot;This code has expired&quot;: press the Petto&apos;s button for a new QR and scan again.</li>
          <li>Bluetooth finds nothing: keep the Petto close, make sure it shows its QR, or just scan the QR.</li>
          <li>Wallet says cancelled: open Meteor, switch to Testnet, and try again.</li>
        </ul>
      </section>
      <div className="flex flex-wrap gap-2">
        <Link href="/start" className="pixel-btn">I&apos;m ready, start setup</Link>
        <Link href="/device-sim" className="pixel-btn pixel-btn--secondary">Try the browser device instead</Link>
      </div>
    </AppFrame>
  );
}
