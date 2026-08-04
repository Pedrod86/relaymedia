import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { listMediaServers } from "./servers.functions";
import {
  getActiveServerId,
  pickActiveServer,
  purgeLegacyTokenStorage,
  setActiveServerId,
  type MediaServer,
} from "./media-client";

/**
 * The connected-server list comes from the server (it lives in the encrypted
 * httpOnly cookie), so the browser never holds any access token. Only the
 * "which one is active" preference is kept in localStorage.
 */
export function useMediaServers() {
  const listFn = useServerFn(listMediaServers);
  const queryClient = useQueryClient();

  useEffect(() => {
    purgeLegacyTokenStorage();
  }, []);

  const query = useQuery({
    queryKey: ["media-servers"],
    queryFn: async () => (await listFn({})).servers as MediaServer[],
    staleTime: 30_000,
  });

  const servers = query.data ?? [];
  const active = pickActiveServer(servers);

  return {
    servers,
    active,
    isLoading: query.isLoading,
    activeId: getActiveServerId(),
    switchTo: (id: string) => {
      setActiveServerId(id);
      queryClient.invalidateQueries({ queryKey: ["media-servers"] });
    },
    refresh: () => queryClient.invalidateQueries({ queryKey: ["media-servers"] }),
  };
}
