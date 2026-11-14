"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { formatPetRef, type PetState } from "@petto/shared";
import { PetSprite } from "@/components/PetSprite";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { FaucetPanel } from "@/components/wallet/FaucetPanel";
import { HatchAnimation } from "@/components/wallet/HatchAnimation";
import { MintForm } from "@/components/wallet/MintForm";
import { AppFrame, DemoSpeedPill, ErrorText, Panel, Spinner } from "@/components/wallet/ui";
import { getPetState } from "@/lib/brain";
import { useHatch } from "@/components/wallet/useHatch";
import { hasWebBluetooth, readPairingUrlOverBle } from "@/lib/ble";
import { accountBalance, petFromRef, petPath, PETS_CONTRACT } from "@/lib/chain";
import { needsFaucet } from "@/lib/faucet";
import { startRedirect } from "@/lib/flow";
import { loadMyPets, type MyPet } from "@/lib/myPets";
import { authHeaders } from "@/lib/session";
import {
  applyFacts, canOpen, currentStep, EMPTY_WIZARD, parseWizard, progress, stepDone, STEPS, WIZARD_KEY,
  type StepId, type WizardFacts, type WizardState,
} from "@/lib/startWizard";
import { Closet } from "@/components/customise/ClosetPicker";
import { ProfileForm } from "@/components/customise/ProfileForm";
import { Soul } from "@/components/customise/SoulEditor";
import { usePet } from "@/components/wallet/usePet";
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
    const s = parseWizard(window.localStorage.getItem(WIZARD_KEY));
    // a pet saved before a contract redeploy (e.g. pets-v8) is not served any more: choose again
    return s.petRef && !petFromRef(s.petRef) ? { ...s, petRef: null, customised: false } : s;
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
  const router = useRouter();
  const params = useSearchParams();
  const urlToken = params.get("t");
  /** From /connect-device: here to pair a Petto, so an existing owner stays and picks a pet. */
  const connectIntent = params.get("connect") === "1";
  const { wallet, session } = useSignIn();
  const [state, setState] = useState<WizardState | null>(null);
  const [open, setOpen] = useState<StepId | null>(null);
  /** Account whose pets were checked: existing owners go home instead of re-running setup (lib/flow.ts). */
  const [checkedFor, setCheckedFor] = useState<string | null>(null);

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

  const account = wallet.accountId;
  const petRef = state?.petRef ?? null;
  const hasDeviceLink = !!urlToken || !!state?.pairingToken || connectIntent;

  // Existing owner (has pets, no QR, no setup in progress): go home instead (lib/flow.ts).
  useEffect(() => {
    if (!state || !account || !session || checkedFor === account) return;
    let live = true;
    loadMyPets(account, authHeaders())
      .then(({ pets }) => {
        if (!live) return;
        const to = startRedirect({ pets, hasDeviceLink, wizardPetRef: petRef });
        if (to) router.replace(to);
        else setCheckedFor(account);
      })
      .catch(() => live && setCheckedFor(account)); // chain unreachable: stay in setup
    return () => {
      live = false;
    };
  }, [state, account, session, checkedFor, hasDeviceLink, petRef, router]);

  // Step 1 is already done once signed in with enough NEAR to hatch; the faucet shows otherwise.
  const confirmed = state?.walletConfirmed ?? false;
  const stateAccount = state?.account ?? null;
  useEffect(() => {
    if (!account || !session || confirmed || stateAccount !== account) return;
    let live = true;
    accountBalance(account)
      .then((b) => live && !needsFaucet(b) && update({ walletConfirmed: true }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [account, session, confirmed, stateAccount, update]);

  if (!state || !wallet.ready || (account && session && checkedFor !== account)) {
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
        <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={STEPS.length - 1} aria-valuenow={done}
          className="grid grid-cols-2 gap-1">
          {[0, 1].map((i) => (
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
                  <StepBody step={st.id} state={state} update={update} accountId={wallet.accountId} signedIn={!!session}
                    preferPick={hasDeviceLink} />
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
  /** Here for a device: list the owner's pets first instead of the hatch form. */
  preferPick: boolean;
}

function StepBody({ step, state, update, accountId, signedIn, preferPick }: StepProps) {
  switch (step) {
    case 1:
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Your wallet owns the pet and pays for its food. Petto runs on NEAR testnet, where NEAR is free.
          </p>
          <ConnectButton />
          {signedIn && <FaucetPanel />}
          {signedIn && (
            <button className="pixel-btn self-start" onClick={() => update({ walletConfirmed: true, petRef: null, customised: false })}>
              Hatch a pet
            </button>
          )}
        </div>
      );
    case 2:
      // hatch (or pick) first, then customise the same pet in this step
      if (!accountId || !signedIn) return <p className="text-sm text-muted">Connect your wallet first.</p>;
      return state.petRef ? (
        <div className="flex flex-col gap-3">
          <CustomiseStep petRef={state.petRef} onNext={() => update({ customised: true })} />
          <button className="self-start text-sm text-muted underline" onClick={() => update({ petRef: null, customised: false })}>
            Hatch or pick a different pet
          </button>
        </div>
      ) : (
        // a pet you already had needs no customising here: straight on to the device step
        <PetStep accountId={accountId} preferPick={preferPick}
          onChosen={(petRef, existing) => update({ petRef, customised: existing })} />
      );
    case 3:
      return state.petRef ? <HandoffStep state={state} update={update} /> : null;
  }
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

function PetStep({ accountId, preferPick, onChosen }: {
  accountId: string;
  preferPick: boolean;
  onChosen: (petRef: string, existing: boolean) => void;
}) {
  const [pets, setPets] = useState<MyPet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // setup is mainly for hatching a new pet; picking an existing one is the secondary path
  const [minting, setMinting] = useState(!preferPick);
  const hatch = useHatch();
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
    // still an egg on chain: hatch it (contract `hatch`); cancelled or failed, the pet page offers it again
    if (p.state && p.state.chain_stage_index === 0) await hatch(p.contract, p.tokenId).catch(() => undefined);
    setBusyRef(null);
    onChosen(p.ref, true);
  }

  if (hatching) {
    const p = petFromRef(hatching);
    return p ? (
      <HatchAnimation
        contract={p.contract}
        tokenId={p.tokenId}
        onDone={async () => {
          if (p) await hatch(p.contract, p.tokenId).catch(() => undefined);
          onChosen(hatching, false);
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
          Or pick a pet I already have
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button className="pixel-btn self-start" onClick={() => setMinting(true)}>
        Hatch a new pet instead
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
                    shirt={p.state.equipped_shirt} costume={p.state.equipped_costume} state={p.state.display_state} scale={2} label={p.name} />
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
  // Everything is edited right here, so customising never leaves setup.
  const data = usePet(petRef);
  if ("invalid" in data) return null;
  if (data.loading) return <Spinner />;
  if (!data.chain) return <ErrorText>{data.error}</ErrorText>;
  const pet = data;
  const name = pet.chain!.name;
  const b = pet.brain;
  const sections: { title: string; body: React.ReactNode }[] = [
    { title: "Write its Soul", body: <Soul pet={pet} /> },
    { title: "Pick a shirt", body: <Closet pet={pet} inSetup /> },
    { title: "Nickname and time zone", body: <ProfileForm pet={pet} /> },
  ];
  return (
    <div className="flex flex-col gap-3">
      {b && (
        <div className="flex items-center gap-3">
          <PetSprite traits={b.traits} stageIndex={b.stage_index} winged={b.form === "winged"}
            shirt={b.equipped_shirt} costume={b.equipped_costume} state={b.display_state} scale={3} label={name} />
          <p className="text-sm text-muted">Give {name} a personality and a look. You can change both later.</p>
        </div>
      )}
      {sections.map((s) => (
        <details key={s.title} className="pixel-panel p-3">
          <summary className="cursor-pointer font-display text-accent">{s.title}</summary>
          <div className="mt-3 flex flex-col gap-3">{s.body}</div>
        </details>
      ))}
      <button className="pixel-btn self-start" onClick={onNext}>
        Next: device or browser
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
    <div className="flex flex-col gap-2 border-t-2 border-line pt-4">
      <h3 className="font-display">No device? Play in the browser</h3>
      <p className="text-sm text-muted">
        The browser Petto has the same pet, chat and fuel. You can pair a device later from {name}&apos;s page.
      </p>
      <Link href={petPath(p.contract, p.tokenId)} className="pixel-btn pixel-btn--secondary self-start">Continue in the browser</Link>
    </div>
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
          <Link href="/connect-device" className="text-sm text-accent underline">How to connect a device, step by step</Link>
        </>
      )}
      {browserLink}
    </div>
  );
}

