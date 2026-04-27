-- ============================================================
-- 升级 rpc_get_gift_tree_status：在 gift_item 嵌套 JSON 中追加 value_tjs
-- 用于在「完成/已领取」页展示礼物价值（CompletionPage 依赖该字段）
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_get_gift_tree_status(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user_id text;
    v_tree record;
    v_tasks jsonb;
    v_today_logs jsonb;
    v_today_total integer;
    v_cooldown_active boolean := false;
    v_has_tree boolean := false;
    v_tree_json jsonb := 'null'::jsonb;
BEGIN
    SELECT user_id INTO v_user_id
    FROM public.user_sessions
    WHERE session_token = p_session_token AND expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_SESSION: Please login first';
    END IF;

    SELECT gt.*, gi.name, gi.name_i18n, gi.image_url, gi.image_urls,
           gi.description, gi.description_i18n, gi.value_tjs
    INTO v_tree
    FROM public.gift_trees gt
    LEFT JOIN public.gift_items gi ON gt.gift_item_id = gi.id
    WHERE gt.user_id = v_user_id AND gt.status = 'GROWING';

    IF v_tree IS NOT NULL THEN
        v_has_tree := true;
        v_tree_json := jsonb_build_object(
            'id', v_tree.id,
            'user_id', v_user_id,
            'current_water', v_tree.current_water,
            'target_water', v_tree.target_water,
            'status', v_tree.status,
            'milestone_200_claimed', v_tree.milestone_200_claimed,
            'milestone_500_claimed', v_tree.milestone_500_claimed,
            'milestone_800_claimed', v_tree.milestone_800_claimed,
            'pickup_code', v_tree.pickup_code,
            'pickup_code_expires_at', v_tree.pickup_code_expires_at,
            'claimed_at', v_tree.claimed_at,
            'created_at', v_tree.created_at,
            'gift_item', jsonb_build_object(
                'id', v_tree.gift_item_id,
                'name', v_tree.name,
                'name_i18n', v_tree.name_i18n,
                'image_url', v_tree.image_url,
                'image_urls', v_tree.image_urls,
                'description', v_tree.description,
                'description_i18n', v_tree.description_i18n,
                'value_tjs', v_tree.value_tjs
            )
        );
    ELSE
        SELECT gt.*, gi.name, gi.name_i18n, gi.image_url, gi.image_urls,
               gi.description, gi.description_i18n, gi.value_tjs
        INTO v_tree
        FROM public.gift_trees gt
        LEFT JOIN public.gift_items gi ON gt.gift_item_id = gi.id
        WHERE gt.user_id = v_user_id AND gt.status IN ('COMPLETED','CLAIMED')
        ORDER BY gt.updated_at DESC LIMIT 1;

        IF v_tree IS NOT NULL THEN
            v_has_tree := true;
            v_tree_json := jsonb_build_object(
                'id', v_tree.id,
                'user_id', v_user_id,
                'current_water', v_tree.current_water,
                'target_water', v_tree.target_water,
                'status', v_tree.status,
                'milestone_200_claimed', v_tree.milestone_200_claimed,
                'milestone_500_claimed', v_tree.milestone_500_claimed,
                'milestone_800_claimed', v_tree.milestone_800_claimed,
                'pickup_code', v_tree.pickup_code,
                'pickup_code_expires_at', v_tree.pickup_code_expires_at,
                'claimed_at', v_tree.claimed_at,
                'created_at', v_tree.created_at,
                'gift_item', jsonb_build_object(
                    'id', v_tree.gift_item_id,
                    'name', v_tree.name,
                    'name_i18n', v_tree.name_i18n,
                    'image_url', v_tree.image_url,
                    'image_urls', v_tree.image_urls,
                    'description', v_tree.description,
                    'description_i18n', v_tree.description_i18n,
                    'value_tjs', v_tree.value_tjs
                )
            );
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.gift_trees
        WHERE user_id = v_user_id AND cooldown_until > now()
    ) THEN
        v_cooldown_active := true;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'task_code', t.task_code,
            'category', t.category,
            'title_i18n', t.title_i18n,
            'description_i18n', t.description_i18n,
            'reward_water', t.reward_water,
            'daily_limit', t.daily_limit,
            'action_route', t.action_route,
            'action_label_i18n', t.action_label_i18n,
            'sort_order', t.sort_order
        ) ORDER BY t.sort_order
    ), '[]'::jsonb) INTO v_tasks
    FROM public.gift_tree_tasks t
    WHERE t.is_active = true;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'task_code', l.task_code,
        'count', l.count,
        'water_earned', l.water_earned
    )), '[]'::jsonb), COALESCE(SUM(l.water_earned), 0)
    INTO v_today_logs, v_today_total
    FROM (
        SELECT task_code,
               COUNT(*) AS count,
               SUM(water_earned) AS water_earned
        FROM public.gift_tree_task_logs
        WHERE user_id = v_user_id
          AND public.to_date_immutable(created_at) = (now() AT TIME ZONE 'UTC')::date
        GROUP BY task_code
    ) l;

    RETURN jsonb_build_object(
        'has_tree', v_has_tree,
        'cooldown_active', v_cooldown_active,
        'tree', v_tree_json,
        'tasks', v_tasks,
        'today_logs', v_today_logs,
        'today_total_water', COALESCE(v_today_total, 0),
        'daily_limit', 100
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_get_gift_tree_status(text) TO authenticated, anon;
