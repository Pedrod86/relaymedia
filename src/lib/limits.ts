// Plan limits. Kept in one place so the server-side enforcement and the UI copy
// can never drift apart.
//
// The connected-server list lives in the encrypted per-device cookie vault, so
// these caps are enforced per device by the server functions that add a server.
export const FREE_SERVER_LIMIT = 1;
export const PRO_SERVER_LIMIT = 12;

// Device caps are account-based: every device that connects a media server
// while signed in is registered against the account in the `devices` table.
export const FREE_DEVICE_LIMIT = 1;
export const PRO_DEVICE_LIMIT = 5;

export function serverLimitFor(isPro: boolean): number {
  return isPro ? PRO_SERVER_LIMIT : FREE_SERVER_LIMIT;
}

export function deviceLimitFor(isPro: boolean): number {
  return isPro ? PRO_DEVICE_LIMIT : FREE_DEVICE_LIMIT;
}

export const SERVER_LIMIT_ERROR =
  `Free accounts can connect ${FREE_SERVER_LIMIT} media server. ` +
  `Unlock Relay Pro to connect up to ${PRO_SERVER_LIMIT} servers on every device you use.`;

export const DEVICE_LIMIT_ERROR =
  `Free accounts can use Relay on ${FREE_DEVICE_LIMIT} device. ` +
  `Unlock Relay Pro to watch on up to ${PRO_DEVICE_LIMIT} devices, ` +
  `or remove a device in Settings to free up a slot.`;
