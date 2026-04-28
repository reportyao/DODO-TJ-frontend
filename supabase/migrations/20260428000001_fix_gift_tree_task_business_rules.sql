-- ============================================================
-- Gift Tree task business rule fixes
-- 1. rpc_water_tree is no longer a generic bypass for every task.
-- 2. STORE_PICKUP can only be awarded after pickup-code verification.
-- 3. FRIEND_HELP can only be awarded through rpc_gift_tree_friend_help.
-- 4. RANDOM_TASK is disabled until an explicit campaign/event implementation exists.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_water_tree(
    p_session_token text,
    p_task_code text,
    p_device_id text DEFAULT NULL::text,
    p_reference_id text DEFAULT NULL::text,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user_id text;
    v_tree record;
BEGIN
    SELECT user_id INTO v_user_id
    FROM public.user_sessions
    WHERE session_token = p_session_token AND expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_SESSION: Please login first';
    END IF;

    SELECT * INTO v_tree
    FROM public.gift_trees
    WHERE user_id = v_user_id AND status = 'GROWING'
    FOR UPDATE;
    IF v_tree IS NULL THEN
        RAISE EXCEPTION 'ERR_NO_TREE: No growing tree found';
    END IF;

    IF p_task_code = 'FRIEND_HELP' THEN
        RAISE EXCEPTION 'ERR_TASK_EVENT_ONLY: Friend-help drops must be granted by rpc_gift_tree_friend_help after a real friend helps';
    ELSIF p_task_code = 'STORE_PICKUP' THEN
        RAISE EXCEPTION 'ERR_TASK_EVENT_ONLY: Store-pickup drops must be granted after pickup-code verification';
    ELSIF p_task_code = 'RANDOM_TASK' THEN
        RAISE EXCEPTION 'ERR_TASK_EVENT_ONLY: Random task is campaign/event driven and cannot be completed directly';
    ELSIF p_task_code = 'FIRST_WATER' THEN
        RAISE EXCEPTION 'ERR_TASK_EVENT_ONLY: First-water task is completed automatically when the tree starts';
    END IF;

    IF p_task_code = 'BROWSE_PRODUCTS' THEN
        IF COALESCE((p_metadata->>'source'), '') <> 'browse_tracker'
           OR COALESCE((p_metadata->>'qualified_products')::integer, 0) < 3 THEN
            RAISE EXCEPTION 'ERR_TASK_INVALID_EVENT: Browse task requires tracked product views';
        END IF;
    END IF;

    RETURN public.rpc_water_tree_internal(
        v_user_id, v_tree.id, p_task_code, p_device_id, p_reference_id, p_metadata
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_gift_tree_store_pickup_verified(
    p_user_id text,
    p_reference_id text,
    p_device_id text DEFAULT NULL::text,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_tree record;
BEGIN
    IF p_user_id IS NULL OR p_reference_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_ARGUMENT: user_id and reference_id are required';
    END IF;

    SELECT * INTO v_tree
    FROM public.gift_trees
    WHERE user_id = p_user_id AND status = 'GROWING'
    FOR UPDATE;

    IF v_tree IS NULL THEN
        RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'NO_GROWING_TREE');
    END IF;

    RETURN public.rpc_water_tree_internal(
        p_user_id,
        v_tree.id,
        'STORE_PICKUP',
        p_device_id,
        'store_pickup_verified_' || p_reference_id,
        p_metadata || jsonb_build_object('source', 'pickup_code_verification')
    );
END;
$function$;

UPDATE public.gift_tree_tasks
SET action_route = '/pending-pickup',
    action_label_i18n = '{"zh":"去提货","ru":"К получению","tg":"Гирифтан"}'::jsonb,
    description_i18n = '{"zh":"提货码核销成功后自动完成","ru":"После проверки кода получения","tg":"Баъд аз санҷиши рамзи гирифтан"}'::jsonb,
    is_active = true
WHERE task_code = 'STORE_PICKUP';

UPDATE public.gift_tree_tasks
SET action_route = NULL,
    action_label_i18n = '{"zh":"邀请好友","ru":"Пригласить","tg":"Даъват"}'::jsonb,
    description_i18n = '{"zh":"好友真实助力后自动完成","ru":"После реальной помощи друга","tg":"Баъд аз кӯмаки воқеии дӯст"}'::jsonb,
    is_active = true
WHERE task_code = 'FRIEND_HELP';

UPDATE public.gift_tree_tasks
SET is_active = false,
    action_route = NULL,
    action_label_i18n = '{}'::jsonb,
    description_i18n = '{"zh":"活动任务开放时自动出现","ru":"Появится во время акции","tg":"Ҳангоми аксия пайдо мешавад"}'::jsonb
WHERE task_code = 'RANDOM_TASK';

GRANT EXECUTE ON FUNCTION public.rpc_water_tree(text, text, text, text, jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rpc_gift_tree_store_pickup_verified(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_gift_tree_store_pickup_verified(text, text, text, jsonb) TO service_role;
