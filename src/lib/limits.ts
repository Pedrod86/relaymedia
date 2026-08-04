// Plan limits. Kept in one place so the server-side enforcement and the UI copy
// can never drift apart.
//
// The connected-server list lives in the encrypted per-device cookie vault, so
// these caps are enforced per device by the server functions that add a server.
export const FREE_SERVER_LIMIT = 1;
export const PRO_SERVER_LIMIT = 12;

export function serverLimitFor(isPro: boolean): number {
  return isPro ? PRO_SERVER_LIMIT : FREE_SERVER_LIMIT;
}

export const SERVER_LIMIT_ERROR =
  `Free accounts can connect ${FREE_SERVER_LIMIT} media server. ` +
  `Unlock Relay Pro to connect up to ${PRO_SERVER_LIMIT} servers on every device you use.`;
