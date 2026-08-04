REVOKE EXECUTE ON FUNCTION public.has_pro_access(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_pro_access(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_pro_access(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.has_pro_access(UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM authenticated;