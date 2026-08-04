// Server functions for the account-based device list shown in Settings.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listDevices = createServerFn({ method: "GET" }).handler(async () => {
  const { listDevicesForCaller } = await import("./devices.server");
  const { devices } = await listDevicesForCaller();
  return { devices };
});

export const revokeDevice = createServerFn({ method: "POST" })
  .inputValidator(z.object({ deviceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { revokeDeviceForCaller, listDevicesForCaller } = await import("./devices.server");
    const ok = await revokeDeviceForCaller(data.deviceId);
    const { devices } = await listDevicesForCaller();
    return { ok, devices };
  });
