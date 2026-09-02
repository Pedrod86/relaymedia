CREATE POLICY "No client access to setup transfers"
ON public.setup_transfers
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);