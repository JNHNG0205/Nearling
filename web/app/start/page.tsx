"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { formatPetRef, type PetState } from "@nearling/shared";
import { PetSprite } from "@/components/PetSprite";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { FaucetPanel } from "@/components/wallet/FaucetPanel";
import { HatchAnimation } from "@/components/wallet/HatchAnimation";
import { MintForm } from "@/components/wallet/MintForm";
import { AppFrame, DemoSpeedPill, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import { getPetState, postHatch } from "@/lib/brain";
import { hasWebBluetooth, readPairingUrlOverBle } from "@/lib/ble";
import { petFromRef, petPath, PETS_CONTRACT } from "@/lib/chain";
import { loadMyPets, type MyPet } from "@/lib/myPets";
import { authHeaders } from "@/lib/session";
import {
  applyFacts, canOpen, currentStep, EMPTY_WIZARD, parseWizard, progress, stepDone, STEPS, WIZARD_KEY,
  type StepId, type WizardFacts, type WizardState,
} from "@/lib/startWizard";
import { useSignIn } from "@/lib/wallet";

// /start: guided setup. Connect the Petto, connect the wallet, choose a pet, make it yours,
// then hand it to the device. Progress is kept in localStorage so a visitor resumes where they left.

export default function StartPage() {
  return (
    <Suspense fallback={<AppFrame title="Set up your Petto" back="/"><Spinner /></AppFrame>}>
      <Wizard />
    </Suspense>
  );
}

function readStored(): WizardState {
  try {
    return parseWizard(window.localStorage.getItem(WIZARD_KEY));
  } catch {
    return EMPTY_WIZARD;
  }
}

function store(s: WizardState) {
  try {
    window.localStorage.setItem(WIZARD_KEY, JSON.stringify(s));
  } catch {
    // private mode: the wizard still works, it just won't resume
  }
}

function tokenFromPath(path: string): string | null {
  return new URLSearchParams(path.split("?")[1] ?? "").get("t");
}

function Wizard() {
  const urlToken = useSearchParams().get("t");
  const { wallet, session } = useSignIn();
  const [state, setState] = useState<WizardState | null>(null);
  const [open, setOpen] = useState<StepId | null>(null);

  const facts: WizardFacts = { account: wallet.accountId, signedIn: !!session, urlToken };

  useEffect(() => {
    setState(readStored());
  }, []);

  // fold live facts (QR token, account) into the stored state
  useEffect(() => {
    if (!state || !wallet.ready) return;
    const next = applyFacts(state, { account: wallet.accountId, signedIn: !!session, urlToken });
    if (next !== state) {
      setState(next);
      store(next);
    }
  }, [state, wallet.ready, wallet.accountId, session, urlToken]);

  const update = useCallback((patch: Partial<WizardState>) => {
    setState((s) => {
      const next = { ...(s ?? EMPTY_WIZARD), ...patch };
      store(next);
      return next;
    });
    setOpen(null);
  }, []);

  if (!state || !wallet.ready) {
    return (
      <AppFrame title="Set up your Petto" back="/">
        <Spinner />
      </AppFrame>
    );
  }

  const current = currentStep(state, facts);
  const active = open && canOpen(state, facts, open) ? open : current;
  const done = progress(state, facts);

  return (
    <AppFrame title="Set up your Petto" back="/">
      <div className="flex flex-col gap-2">
        <p className="font-display text-sm text-muted">Step {active} of {STEPS.length}</p>
        <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={4} aria-valuenow={done}
          className="grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-3 border-2 border-line ${i < done ? "bg-accent" : "bg-surface"}`} />
          ))}
        </div>
      </div>
      <ol className="flex flex-col gap-3">
        {STEPS.map((st) => {
          const isDone = stepDone(state, facts, st.id);
          const isActive = st.id === active;
          const reachable = canOpen(state, facts, st.id);
          return (
            <li key={st.id}>
              <section aria-label={st.title} className={`pixel-panel flex flex-col gap-3 p-4 ${isActive ? "border-accent" : ""}`}>
                <header className="flex items-center gap-3">
                  <span className={`font-display ${isDone ? "text-fuel" : "text-muted"}`} aria-hidden>
                    {isDone ? "[v]" : `${st.id}.`}
                  </span>
                  <h2 className={`flex-1 font-display text-lg ${reachable ? "" : "text-muted"}`}>{st.title}</h2>
                  {!isActive && isDone && (
                    <button className="text-sm text-accent underline" onClick={() => setOpen(st.id)}>
                      Change
                    </button>
                  )}
                </header>
                {isActive && (
                  <StepBody step={st.id} state={state} update={update} accountId={wallet.accountId} signedIn={!!session} />
                )}
              </section>
            </li>
          );
        })}
      </ol>
    </AppFrame>
  );
}

interface StepProps {
  step: StepId;
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  accountId: string | null;
  signedIn: boolean;
}

function StepBody({ step, state, update, accountId, signedIn }: StepProps) {
  switch (step) {
    case 1:
      return <DeviceStep state={state} update={update} />;
    case 2:
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Your wallet owns the pet and pays for its food. Petto runs on NEAR testnet, where NEAR is free.
          </p>
          <ConnectButton />
          {signedIn && <FaucetPanel />}
          {signedIn && (
            <button className="pixel-btn self-start" onClick={() => update({ walletConfirmed: true })}>
              Choose a pet
            </button>
          )}
        </div>
      );
    case 3:
      return accountId && signedIn ? (
        <PetStep accountId={accountId} onChosen={(petRef) => update({ petRef, customised: false })} />
      ) : (
        <p className="text-sm text-muted">Connect your wallet first.</p>
      );
    case 4:
      return state.petRef ? <CustomiseStep petRef={state.petRef} onNext={() => update({ customised: true })} /> : null;
    case 5:
      return state.petRef ? <HandoffStep state={state} update={update} /> : null;
  }
}

// ---------- step 1 ----------

function DeviceStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {state.device === "qr" && state.pairingToken && (
        <p className="text-sm text-fuel">Your Petto sent you here. You will pair it with your pet in step 5.</p>
      )}
      <DeviceOptions
        onBle={(token) => update({ device: "ble", pairingToken: token })}
      />
      <div className="flex flex-col gap-2 border-t-2 border-line pt-4">
        <h3 className="font-display">No device yet</h3>
        <p className="text-sm text-muted">The browser Petto has the same pet, chat and fuel. You can pair a device later.</p>
        <button className="pixel-btn pixel-btn--secondary self-start" onClick={() => update({ device: "browser" })}>
          Continue in the browser
        </button>
      </div>
    </div>
  );
}

/** QR explanation plus Bluetooth discovery where the browser supports it. Used in steps 1 and 5. */
function DeviceOptions({ onBle }: { onBle: (token: string | null) => void }) {
  const router = useRouter();
  const [bleSupported, setBleSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setBleSupported(hasWebBluetooth()), []);

  async function findOverBle() {
    setBusy(true);
    setError(null);
    const r = await readPairingUrlOverBle();
    setBusy(false);
    if (r.ok) {
      onBle(tokenFromPath(r.path));
      router.push(r.path);
      return;
    }
    if (r.reason === "cancelled") return;
    setError(
      r.reason === "bad_url"
        ? "Your Petto answered, but not with a pairing link. Restart pairing on the device and try again."
        : "Couldn't reach your Petto over Bluetooth. Keep it close, check it shows its QR, and try again.",
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="font-display">Scan the QR on your Petto</h3>
        <p className="text-sm text-muted">
          Turn on your Petto and join it to Wi-Fi. It shows a QR code. Scan it with your phone camera: it opens
          this site&apos;s pairing page, where you pick or hatch the pet that lives on it.
        </p>
      </div>
      {bleSupported ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-display">Find my Petto over Bluetooth</h3>
          <p className="text-sm text-muted">
            Your browser lists Pettos nearby. Pick yours and it opens the same pairing page.
          </p>
          <button className="pixel-btn self-start" disabled={busy} onClick={() => void findOverBle()}>
            {busy ? "Looking..." : "Find my Petto"}
          </button>
          <ErrorText>{error}</ErrorText>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Bluetooth pairing needs Chrome or Edge on a computer or Android. On iPhone and Safari, use the QR code.
        </p>
      )}
    </div>
  );
}

// ---------- step 3 ----------

function PetStep({ accountId, onChosen }: { accountId: string; onChosen: (petRef: string) => void }) {
  const [pets, setPets] = useState<MyPet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [hatching, setHatching] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadMyPets(accountId, authHeaders())
      .then((r) => live && setPets(r.pets))
      .catch(() => live && setError("Couldn't load your pets from NEAR testnet. Refresh to retry."));
    return () => {
      live = false;
    };
  }, [accountId]);

  async function choose(p: MyPet) {
    setBusyRef(p.ref);
    // an egg that never hatched hatches now (Build Spec 1); brain down: the pet page offers it again
    if (p.state && !p.state.hatched) await postHatch(p.ref, authHeaders()).catch(() => undefined);
    setBusyRef(null);
    onChosen(p.ref);
  }

  if (hatching) {
    const p = petFromRef(hatching);
    return p ? (
      <HatchAnimation
        contract={p.contract}
        tokenId={p.tokenId}
        onDone={async () => {
          await postHatch(hatching, authHeaders()).catch(() => undefined);
          onChosen(hatching);
        }}
      />
    ) : null;
  }

  if (minting) {
    return (
      <div className="flex flex-col gap-3">
        <FaucetPanel />
        <MintForm contract={PETS_CONTRACT} onMinted={(id) => setHatching(formatPetRef(PETS_CONTRACT, id))} />
        <button className="self-start text-sm text-muted underline" onClick={() => setMinting(false)}>
          Pick a pet I have instead
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button className="pixel-btn self-start" onClick={() => setMinting(true)}>
        Hatch a new pet
      </button>
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : pets === null ? (
        <Spinner label="Looking for your pets..." />
      ) : pets.length === 0 ? (
        <p className="text-sm text-muted">No pets on this account yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pets.map((p) => (
            <li key={p.ref}>
              <button
                className="pixel-panel flex w-full items-center gap-3 p-3 text-left hover:border-accent"
                disabled={busyRef !== null}
                onClick={() => void choose(p)}
              >
                {p.state && (
                  <PetSprite traits={p.state.traits} stageIndex={p.state.stage_index} winged={p.state.form === "winged"}
                    shirt={p.state.equipped_shirt} state={p.state.display_state} scale={2} label={p.name} />
                )}
                <span className="flex flex-1 flex-col gap-1">
                  <span className="font-display">{busyRef === p.ref ? `Choosing ${p.name}...` : `Choose ${p.name}`}</span>
                  {p.demo && <DemoSpeedPill />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- steps 4 and 5 ----------

function usePetState(petRef: string): { pet: PetState | null; failed: boolean } {
  const [pet, setPet] = useState<PetState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    getPetState(petRef, { cache: "no-store" })
      .then((s) => live && setPet(s))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [petRef]);
  return { pet, failed };
}

function CustomiseStep({ petRef, onNext }: { petRef: string; onNext: () => void }) {
  const { pet, failed } = usePetState(petRef);
  const p = petFromRef(petRef);
  if (!p) return null;
  const name = pet?.name ?? "your pet";
  const cards = [
    {
      href: petPath(p.contract, p.tokenId, "/soul"),
      title: "Write its Soul",
      body: pet ? (pet.soul_version > 0 ? `Soul version ${pet.soul_version}, public on NEAR.` : "No Soul yet. It uses the default voice.") : null,
    },
    {
      href: petPath(p.contract, p.tokenId, "/closet"),
      title: "Pick a shirt",
      body: pet ? (pet.equipped_shirt ? `Wearing shirt #${pet.equipped_shirt}.` : "No shirt yet. Claim one free shirt.") : null,
    },
    {
      href: petPath(p.contract, p.tokenId, "/settings"),
      title: "Set nickname and time zone",
      body: "What it calls you, and when it says good morning.",
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {pet && (
        <div className="flex items-center gap-3">
          <PetSprite traits={pet.traits} stageIndex={pet.stage_index} winged={pet.form === "winged"}
            shirt={pet.equipped_shirt} state={pet.display_state} scale={3} label={pet.name} />
          <p className="text-sm text-muted">Give {name} a personality and a look. You can change both later.</p>
        </div>
      )}
      {failed && <ErrorText>Couldn&apos;t reach Petto&apos;s brain, so the Soul version and shirt are not shown.</ErrorText>}
      <ul className="flex flex-col gap-2">
        {cards.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="pixel-panel flex flex-col gap-1 p-3 hover:border-accent">
              <span className="font-display text-accent">{c.title}</span>
              {c.body && <span className="text-sm text-muted">{c.body}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <button className="pixel-btn self-start" onClick={onNext}>
        Continue to hand-off
      </button>
    </div>
  );
}

function HandoffStep({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const { pet, failed } = usePetState(state.petRef!);
  const p = petFromRef(state.petRef!);
  if (!p) return null;
  const name = pet?.name ?? "your pet";
  const browserLink = (
    <Link href={petPath(p.contract, p.tokenId)} className="pixel-btn pixel-btn--secondary self-start">
      Open {name} in the browser
    </Link>
  );

  if (!pet && !failed) return <Spinner />;

  if (pet?.device.paired) {
    return (
      <div className="flex flex-col gap-3">
        <p>
          {name} lives on your Petto now. From here on you pat, rock, feed and talk to it on the device, and
          wallet actions wait for you to hold Approve on it.
        </p>
        <Link href={petPath(p.contract, p.tokenId, "/device")} className="pixel-btn self-start">
          Give your Petto its key
        </Link>
        <p className="text-sm text-muted">The key lets the device sign care and approvals for {name}, within limits the contract sets.</p>
        {browserLink}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {failed && <ErrorText>Couldn&apos;t reach Petto&apos;s brain to check for a paired device.</ErrorText>}
      {state.pairingToken && state.device === "qr" ? (
        <div className="flex flex-col gap-2">
          <p>Your Petto is waiting. Pair it with {name} and press its button when it asks.</p>
          <Link href={`/hatch?t=${encodeURIComponent(state.pairingToken)}`} className="pixel-btn self-start">
            Pair {name} with my Petto
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">No Petto is paired with {name} yet. Pair one to care, chat and approve on the device.</p>
          <DeviceOptions onBle={(token) => update({ device: "ble", pairingToken: token })} />
        </>
      )}
      {browserLink}
    </div>
  );
}
