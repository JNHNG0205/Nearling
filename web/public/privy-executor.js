// Petto "Email or Google" wallet for NEAR Connect. Runs in NEAR Connect's sandbox and forwards
// every call to `window.pettoPrivy` on the Petto page (web/lib/privyHost.ts), which signs in-page
// with the user's Privy NEAR wallet behind a confirm modal. No popup, no new tab.
// Allowed by the manifest permission `external: ["pettoPrivy"]` (web/lib/privy.ts).
const host = (method, params) => window.selector.external("pettoPrivy", method, params ?? {});

window.selector.ready({
  manifest: {},
  signIn: (data) => host("signIn", data),
  signInAndSignMessage: (data) => host("signInAndSignMessage", data),
  signOut: (data) => host("signOut", data),
  getAccounts: (data) => host("getAccounts", data),
  signMessage: (params) => host("signMessage", params),
  signAndSendTransaction: (params) => host("signAndSendTransaction", params),
  signAndSendTransactions: (params) => host("signAndSendTransactions", params),
  signDelegateActions: (params) => host("signDelegateActions", params),
});
