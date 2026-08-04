import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProStatus } from "@/lib/payments.functions";
import { getStripeEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { useAuth } from "@/lib/use-auth";

export type ProAccess = {
  isPro: boolean;
  isSignedIn: boolean;
  isLoading: boolean;
  purchasedAt: string | null;
  refresh: () => void;
};

/**
 * Whether the signed-in account has unlocked Relay Pro.
 *
 * This is a UX signal only — anything that must be trustworthy re-checks the
 * purchases table server-side.
 */
export function useProAccess(): ProAccess {
  const { user, isLoading: authLoading } = useAuth();
  const fetchStatus = useServerFn(getProStatus);
  const queryClient = useQueryClient();
  const configured = isPaymentsConfigured();

  const query = useQuery({
    queryKey: ["pro-status", user?.id],
    enabled: Boolean(user) && configured,
    queryFn: () => fetchStatus({ data: { environment: getStripeEnvironment() } }),
  });

  return {
    isPro: query.data?.isPro ?? false,
    isSignedIn: Boolean(user),
    isLoading: authLoading || (Boolean(user) && configured && query.isLoading),
    purchasedAt: query.data?.purchasedAt ?? null,
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: ["pro-status"] });
    },
  };
}
