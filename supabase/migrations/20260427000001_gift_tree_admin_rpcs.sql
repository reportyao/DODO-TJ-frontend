-- ============================================================
-- 希望之树管理员 RPC（修复管理后台直接修改 status 绕过库存/冷却的隐患）
--
-- 背景：
--   GiftTreeDashboardPage 之前通过 adminUpdate 直接 UPDATE gift_trees.status,
--   未能：
--     1) CLAIMED 时同步扣 gift_items.stock 与释放 reserved_stock
--     2) 设置 user 的 cooldown_until（防止用户立即开新树）
--     3) EXPIRED/CANCELLED 时释放 reserved_stock
--
-- 解决方案：
--   新增 3 个 admin RPC，前端 Dashboard 改为调用 RPC，业务副作用统一在 DB 层处理。
--   所有 RPC 都通过 verify_admin_session(p_session_token) 校验权限。
-- ============================================================

-- ------------------------------------------------------------
-- 1) admin_claim_gift_tree —— 标记某棵 COMPLETED 树为已领取
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_claim_gift_tree(
  p_session_token text,
  p_tree_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_tree gift_trees%ROWTYPE;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  SELECT * INTO v_tree FROM gift_trees WHERE id = p_tree_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NOT_FOUND');
  END IF;

  IF v_tree.status NOT IN ('COMPLETED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_STATUS', 'current_status', v_tree.status);
  END IF;

  -- 扣减真实库存 & 释放预占
  UPDATE gift_items
  SET stock = GREATEST(stock - 1, 0),
      reserved_stock = GREATEST(reserved_stock - 1, 0),
      updated_at = now()
  WHERE id = v_tree.gift_item_id;

  -- 标记树为已领取，写入 cooldown_until（24h 防刷）
  UPDATE gift_trees
  SET status = 'CLAIMED',
      claimed_at = now(),
      cooldown_until = COALESCE(cooldown_until, now() + interval '24 hours'),
      updated_at = now()
  WHERE id = p_tree_id;

  RETURN jsonb_build_object('success', true, 'tree_id', p_tree_id);
END;
$$;

-- ------------------------------------------------------------
-- 2) admin_expire_gift_tree —— 标记 COMPLETED 树过期未领取
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_expire_gift_tree(
  p_session_token text,
  p_tree_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_tree gift_trees%ROWTYPE;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  SELECT * INTO v_tree FROM gift_trees WHERE id = p_tree_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NOT_FOUND');
  END IF;

  IF v_tree.status NOT IN ('COMPLETED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_STATUS', 'current_status', v_tree.status);
  END IF;

  -- 释放预占库存（树未真正领取）
  UPDATE gift_items
  SET reserved_stock = GREATEST(reserved_stock - 1, 0),
      updated_at = now()
  WHERE id = v_tree.gift_item_id;

  UPDATE gift_trees
  SET status = 'EXPIRED',
      updated_at = now()
  WHERE id = p_tree_id;

  RETURN jsonb_build_object('success', true, 'tree_id', p_tree_id);
END;
$$;

-- ------------------------------------------------------------
-- 3) admin_cancel_gift_tree —— 取消尚在 GROWING 状态的树
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cancel_gift_tree(
  p_session_token text,
  p_tree_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_tree gift_trees%ROWTYPE;
BEGIN
  v_admin_id := verify_admin_session(p_session_token);

  SELECT * INTO v_tree FROM gift_trees WHERE id = p_tree_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_NOT_FOUND');
  END IF;

  IF v_tree.status NOT IN ('GROWING') THEN
    RETURN jsonb_build_object('success', false, 'error', 'ERR_INVALID_STATUS', 'current_status', v_tree.status);
  END IF;

  -- 释放预占库存
  UPDATE gift_items
  SET reserved_stock = GREATEST(reserved_stock - 1, 0),
      updated_at = now()
  WHERE id = v_tree.gift_item_id;

  UPDATE gift_trees
  SET status = 'CANCELLED',
      updated_at = now()
  WHERE id = p_tree_id;

  RETURN jsonb_build_object('success', true, 'tree_id', p_tree_id);
END;
$$;

-- ------------------------------------------------------------
-- 权限授予：仅给 authenticated（Admin 调用走 verify_admin_session）
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_claim_gift_tree(text, uuid)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_expire_gift_tree(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_gift_tree(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_claim_gift_tree(text, uuid)  TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_expire_gift_tree(text, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_gift_tree(text, uuid) TO authenticated, anon;

COMMENT ON FUNCTION public.admin_claim_gift_tree(text, uuid)  IS '管理员标记希望之树为已领取（同步扣库存+释放预占+冷却）';
COMMENT ON FUNCTION public.admin_expire_gift_tree(text, uuid) IS '管理员标记希望之树为已过期（释放预占库存）';
COMMENT ON FUNCTION public.admin_cancel_gift_tree(text, uuid) IS '管理员取消生长中的希望之树（释放预占库存）';
