CREATE TABLE public.setup_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  payload text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.setup_transfers TO service_role;

ALTER TABLE public.setup_transfers ENABLE ROW LEVEL SECURITY;

CREATE INDEX setup_transfers_expires_at_idx ON public.setup_transfers (expires_at);