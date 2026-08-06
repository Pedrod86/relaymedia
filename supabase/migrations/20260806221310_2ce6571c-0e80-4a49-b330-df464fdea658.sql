-- Owner-scoped access for the private 'storage1' bucket.
-- Convention: objects must be stored under a top-level folder equal to the user's id.

CREATE POLICY "Users can read their own files in storage1"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'storage1'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can upload their own files in storage1"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'storage1'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own files in storage1"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'storage1'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'storage1'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own files in storage1"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'storage1'
  AND (storage.foldername(name))[1] = auth.uid()::text
);