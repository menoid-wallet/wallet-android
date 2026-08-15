/**
 * useRefresh — React bindings for lib/refreshBus.
 */

import { useEffect, useState } from "react";
import { getNonce, isBusy, subscribeBusy, subscribeTick, type Scope } from "./refreshBus";

/** Re-renders whenever the refresh button is pressed. Watch the returned value. */
export function useRefreshNonce(): number {
  const [n, setN] = useState(getNonce);
  useEffect(() => subscribeTick(() => setN(getNonce())), []);
  return n;
}

/** True while a manual reload of THIS scope is running — drives the dim. */
export function useRefreshBusy(scope: Scope): boolean {
  const [busy, setBusy] = useState(() => isBusy(scope));
  useEffect(() => subscribeBusy(() => setBusy(isBusy(scope))), [scope]);
  return busy;
}
