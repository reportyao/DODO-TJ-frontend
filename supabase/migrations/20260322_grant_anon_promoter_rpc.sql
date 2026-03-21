-- Grant anon role execute permission on get_promoter_center_data
-- Date: 2026-03-22
-- Reason: ProfilePage and PromoterCenterPage call this RPC with anon key
-- The function is SECURITY DEFINER and validates user internally via p_user_id
GRANT EXECUTE ON FUNCTION get_promoter_center_data(TEXT, TEXT) TO anon;
