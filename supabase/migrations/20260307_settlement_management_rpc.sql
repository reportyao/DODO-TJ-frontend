-- ============================================================
-- 缴款管理 RPC 函数
-- 版本: 1.0.0
-- 日期: 2026-03-07
--
-- 功能:
--   1. get_admin_settlement_list: 获取指定日期的缴款记录列表
--   2. confirm_promoter_settlement: 确认缴款（含行级锁保护）
--
-- 设计原则:
--   - SECURITY DEFINER 确保 service_role 权限
--   - 所有金额计算在数据库层面完成，使用 NUMERIC 类型
--   - 时区统一使用 Asia/Dushanbe
--   - 行级锁防止并发操作
--   - 与现有 admin RPC 函数风格保持一致
-- ============================================================

-- ============================================================
-- 函数1: get_admin_settlement_list
-- 功能: 获取指定日期的缴款记录列表，关联地推人员信息
-- 用途: Admin后台缴款管理页面的数据列表
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_settlement_list(
  p_settlement_date DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'records', COALESCE(
      (
        SELECT json_agg(row_data ORDER BY row_data.total_deposit_amount DESC)
        FROM (
          SELECT
            ps.id,
            ps.promoter_id,
            ps.settlement_date,
            ps.total_deposit_amount,
            ps.total_deposit_count,
            ps.settlement_amount,
            ps.settlement_method,
            ps.proof_image_url,
            ps.settlement_status,
            ps.confirmed_by,
            ps.confirmed_at,
            ps.note,
            ps.created_at,
            ps.updated_at,
            -- 关联地推人员信息 [MIGRATION] 使用 phone_number 替代 telegram_id
            COALESCE(
              NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), ''),
              u.phone_number,
              ps.promoter_id
            ) AS promoter_name,
            u.phone_number AS promoter_phone_number
          FROM promoter_settlements ps
          LEFT JOIN users u ON u.id::TEXT = ps.promoter_id
          WHERE ps.settlement_date = p_settlement_date
        ) row_data
      ),
      '[]'::json
    ),
    'stats', (
      SELECT json_build_object(
        'total_records', COUNT(*)::INTEGER,
        'pending_count', COUNT(*) FILTER (WHERE settlement_status = 'pending')::INTEGER,
        'settled_count', COUNT(*) FILTER (WHERE settlement_status = 'settled')::INTEGER,
        'discrepancy_count', COUNT(*) FILTER (WHERE settlement_status = 'discrepancy')::INTEGER,
        'total_deposit_amount', COALESCE(SUM(total_deposit_amount), 0)::NUMERIC(12,2),
        'total_settled_amount', COALESCE(SUM(settlement_amount), 0)::NUMERIC(12,2)
      )
      FROM promoter_settlements
      WHERE settlement_date = p_settlement_date
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_admin_settlement_list(DATE)
  IS '获取指定日期的缴款记录列表，含地推人员信息和统计数据';

-- ============================================================
-- 函数2: confirm_promoter_settlement
-- 功能: 确认一笔缴款记录，含行级锁保护
-- 用途: Admin后台缴款管理页面的确认操作
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_promoter_settlement(
  p_settlement_id UUID,
  p_settlement_amount NUMERIC,
  p_settlement_method TEXT,
  p_proof_image_url TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_admin_id TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_settlement RECORD;
  v_is_discrepancy BOOLEAN;
  v_new_status TEXT;
BEGIN
  -- ============================================================
  -- Step 1: 参数验证
  -- ============================================================
  IF p_settlement_amount IS NULL OR p_settlement_amount <= 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'INVALID_AMOUNT',
      'detail', '缴款金额必须大于0'
    );
  END IF;

  IF p_settlement_method IS NULL OR p_settlement_method NOT IN ('cash', 'transfer') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'INVALID_METHOD',
      'detail', '缴款方式必须为 cash 或 transfer'
    );
  END IF;

  -- 转账方式必须上传凭证
  IF p_settlement_method = 'transfer' AND (p_proof_image_url IS NULL OR p_proof_image_url = '') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'PROOF_REQUIRED',
      'detail', '转账方式必须上传转账凭证'
    );
  END IF;

  -- ============================================================
  -- Step 2: 行级锁定目标记录
  -- ============================================================
  SELECT *
  INTO v_settlement
  FROM promoter_settlements
  WHERE id = p_settlement_id
  FOR UPDATE;

  IF v_settlement IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'NOT_FOUND',
      'detail', '缴款记录不存在'
    );
  END IF;

  -- 已确认的记录不允许重复确认
  IF v_settlement.settlement_status IN ('settled', 'discrepancy') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'ALREADY_CONFIRMED',
      'detail', '该记录已被确认，状态: ' || v_settlement.settlement_status
    );
  END IF;

  -- ============================================================
  -- Step 3: 判断金额一致性（允许0.01的浮点误差）
  -- ============================================================
  v_is_discrepancy := ABS(p_settlement_amount - COALESCE(v_settlement.total_deposit_amount, 0)) > 0.01;
  v_new_status := CASE WHEN v_is_discrepancy THEN 'discrepancy' ELSE 'settled' END;

  -- ============================================================
  -- Step 4: 更新缴款记录
  -- ============================================================
  UPDATE promoter_settlements
  SET
    settlement_amount = p_settlement_amount,
    settlement_method = p_settlement_method,
    proof_image_url = CASE
      WHEN p_proof_image_url IS NOT NULL AND p_proof_image_url != '' THEN p_proof_image_url
      ELSE NULL
    END,
    settlement_status = v_new_status,
    confirmed_by = COALESCE(p_admin_id, 'unknown'),
    confirmed_at = now(),
    note = p_note,
    updated_at = now()
  WHERE id = p_settlement_id;

  -- ============================================================
  -- Step 5: 返回结果
  -- ============================================================
  RETURN json_build_object(
    'success', true,
    'settlement_id', p_settlement_id,
    'new_status', v_new_status,
    'is_discrepancy', v_is_discrepancy,
    'settlement_amount', p_settlement_amount,
    'total_deposit_amount', v_settlement.total_deposit_amount
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'INTERNAL_ERROR',
      'detail', SQLERRM
    );
END;
$function$;

COMMENT ON FUNCTION public.confirm_promoter_settlement(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT)
  IS '确认地推人员缴款记录，含行级锁保护和金额一致性校验';
