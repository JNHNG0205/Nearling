import { describe, expect, it } from "vitest";
import { nearToYocto } from "near-api-js";
import { hatchPathFromPairingUrl } from "./ble";
import { FAUCET_THRESHOLD, needsFaucet } from "./faucet";
import {
  applyFacts, canOpen, currentStep, EMPTY_WIZARD, parseWizard, progress, stepDone, type WizardFacts, type WizardState,
} from "./startWizard";

const ACC = "alice.testnet";
const out: WizardFacts = { account: null, signedIn: false, urlToken: null };
const signedIn: WizardFacts = { account: ACC, signedIn: true, urlToken: null };
const with_ = (p: Partial<WizardState>): WizardState => ({ ...EMPTY_WIZARD, ...p });

describe("start wizard: resume", () => {
  it("starts a new visitor at step 1", () => {
    expect(currentStep(parseWizard(null), out)).toBe(1);
  });

  it("falls back to an empty wizard for bad or old storage", () => {
    expect(parseWizard("{not json")).toEqual(EMPTY_WIZARD);
    expect(parseWizard('{"v":0,"device":"qr"}')).toEqual(EMPTY_WIZARD);
    expect(parseWizard('{"v":1,"device":"laser","petRef":42}')).toEqual(EMPTY_WIZARD);
  });

  it("round-trips through storage and resumes at the first open step", () => {
    const s = with_({ device: "ble", account: ACC, walletConfirmed: true, petRef: "pets-v8.nearling.testnet:3" });
    const back = parseWizard(JSON.stringify(s));
    expect(back).toEqual(s);
    expect(currentStep(back, signedIn)).toBe(3);
  });

  it("resumes at step 1 when the session is gone, even with a pet saved", () => {
    const s = with_({ device: "qr", account: ACC, walletConfirmed: true, petRef: "pets-v8.nearling.testnet:3", customised: true });
    expect(currentStep(s, out)).toBe(1);
  });
});

describe("start wizard: skip and completion", () => {
  it("arriving from the QR link keeps the token for the device step", () => {
    const s = applyFacts(EMPTY_WIZARD, { ...out, urlToken: "abc123" });
    expect(s.device).toBe("qr");
    expect(s.pairingToken).toBe("abc123");
    expect(currentStep(s, out)).toBe(1);
  });

  it("step 1 needs a signed-in session and the owner's go-ahead", () => {
    const s = applyFacts(EMPTY_WIZARD, signedIn);
    expect(stepDone(s, signedIn, 1)).toBe(false);
    expect(stepDone({ ...s, walletConfirmed: true }, signedIn, 1)).toBe(true);
    expect(stepDone({ ...s, walletConfirmed: true }, { ...signedIn, signedIn: false }, 1)).toBe(false);
  });

  it("a different account resets the wallet go-ahead and the pet", () => {
    const s = with_({ device: "browser", account: ACC, walletConfirmed: true, petRef: "pets-v8.nearling.testnet:3", customised: true });
    const next = applyFacts(s, { account: "bob.testnet", signedIn: true, urlToken: null });
    expect(next).toMatchObject({ account: "bob.testnet", walletConfirmed: false, petRef: null, customised: false, device: "browser" });
  });

  it("returns the same object when nothing changed (no store loop)", () => {
    const s = with_({ device: "browser", account: ACC });
    expect(applyFacts(s, signedIn)).toBe(s);
  });

  it("ends at step 4 (device or browser), which is never marked done", () => {
    const s = with_({ device: "ble", account: ACC, walletConfirmed: true, petRef: "pets-v8.nearling.testnet:3", customised: true });
    expect(currentStep(s, signedIn)).toBe(4);
    expect(stepDone(s, signedIn, 4)).toBe(false);
    expect(progress(s, signedIn)).toBe(3);
  });

  it("cannot jump ahead, can reopen earlier steps", () => {
    const s = with_({ account: ACC, walletConfirmed: true });
    expect(canOpen(s, signedIn, 1)).toBe(true);
    expect(canOpen(s, signedIn, 2)).toBe(true);
    expect(canOpen(s, signedIn, 3)).toBe(false);
  });
});

describe("faucet threshold", () => {
  it("is 0.3 NEAR", () => {
    expect(FAUCET_THRESHOLD).toBe(nearToYocto("0.3"));
  });

  it("shows under the threshold, hides at or above it and while unknown", () => {
    expect(needsFaucet(0n)).toBe(true);
    expect(needsFaucet(FAUCET_THRESHOLD - 1n)).toBe(true);
    expect(needsFaucet(FAUCET_THRESHOLD)).toBe(false);
    expect(needsFaucet(nearToYocto("10"))).toBe(false);
    expect(needsFaucet(null)).toBe(false);
  });

  it("takes a custom need", () => {
    expect(needsFaucet(nearToYocto("1"), nearToYocto("2"))).toBe(true);
  });
});

describe("Bluetooth pairing url", () => {
  it("keeps only the token as a local hatch path", () => {
    expect(hatchPathFromPairingUrl("https://nearling.app/hatch?t=Ab_9-x")).toBe("/hatch?t=Ab_9-x");
    expect(hatchPathFromPairingUrl("/hatch?t=abcd\n")).toBe("/hatch?t=abcd");
  });

  it("rejects other paths, missing or odd tokens", () => {
    expect(hatchPathFromPairingUrl("https://evil.example/login?t=abcd")).toBeNull();
    expect(hatchPathFromPairingUrl("https://nearling.app/hatch")).toBeNull();
    expect(hatchPathFromPairingUrl("/hatch?t=<script>")).toBeNull();
    expect(hatchPathFromPairingUrl("")).toBeNull();
  });
});
