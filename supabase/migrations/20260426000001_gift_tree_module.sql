-- ============================================================
-- DODO 希望之树 (Gift Tree / Darakhti Umid) 模块
-- 数据库 Schema、辅助函数、RPC 函数与种子数据
--
-- 模块说明：
--   - gift_items          : 礼物商品池
--   - gift_trees          : 用户的浇水/育树记录
--   - gift_tree_tasks     : 任务定义（每日/一次性/社交/随机）
--   - gift_tree_task_logs : 浇水/任务执行流水
--   - gift_tree_help_logs : 好友助力流水
--
-- RPC 函数：
--   - rpc_get_gift_tree_status(p_session_token)
--   - rpc_start_gift_tree(p_session_token, p_gift_item_id)
--   - rpc_water_tree(p_session_token, p_task_code, p_device_id, p_reference_id, p_metadata)
--   - rpc_water_tree_internal(...)  -- 仅内部调用
--   - rpc_gift_tree_friend_help(p_session_token, p_tree_owner_id, p_device_id)
--   - rpc_claim_gift_tree(p_session_token, p_pickup_code, p_pickup_point_id)
--
-- 依赖：
--   - extension uuid-ossp（uuid_generate_v4）
--   - 已有表：public.user_sessions、public.admin_sessions
--   - 已有函数：public.add_bonus_balance(p_user_id text, p_amount numeric, p_description text)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- 辅助函数：immutable 的 timestamptz -> date 转换
-- 用于在表达式索引中使用，避免 (created_at::date) 不可变的问题
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.to_date_immutable(ts timestamp with time zone)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $function$ SELECT ts::date; $function$;

-- ============================================================
-- Table: public.gift_items（礼物商品池）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gift_items (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    name_i18n jsonb DEFAULT '{}'::jsonb,
    description text,
    description_i18n jsonb DEFAULT '{}'::jsonb,
    image_url text DEFAULT ''::text NOT NULL,
    image_urls text[] DEFAULT '{}'::text[],
    target_water integer DEFAULT 1000 NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    reserved_stock integer DEFAULT 0 NOT NULL,
    value_tjs numeric DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT gift_items_pkey PRIMARY KEY (id),
    CONSTRAINT gift_items_reserved_stock_check CHECK ((reserved_stock >= 0)),
    CONSTRAINT gift_items_stock_check CHECK ((stock >= 0)),
    CONSTRAINT gift_items_target_water_check CHECK ((target_water > 0))
);
CREATE INDEX IF NOT EXISTS idx_gift_items_active ON public.gift_items USING btree (is_active, sort_order);

-- ============================================================
-- Table: public.gift_trees（用户育树记录）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gift_trees (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id text NOT NULL,
    gift_item_id uuid NOT NULL,
    current_water integer DEFAULT 0 NOT NULL,
    target_water integer DEFAULT 1000 NOT NULL,
    status text DEFAULT 'GROWING'::text NOT NULL,
    milestone_200_claimed boolean DEFAULT false NOT NULL,
    milestone_500_claimed boolean DEFAULT false NOT NULL,
    milestone_800_claimed boolean DEFAULT false NOT NULL,
    pickup_code text,
    pickup_code_expires_at timestamptz,
    pickup_point_id uuid,
    claimed_at timestamptz,
    cooldown_until timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT gift_trees_pkey PRIMARY KEY (id),
    CONSTRAINT gift_trees_pickup_code_key UNIQUE (pickup_code),
    CONSTRAINT gift_trees_current_water_check CHECK ((current_water >= 0)),
    CONSTRAINT gift_trees_status_check CHECK ((status = ANY (ARRAY['GROWING'::text, 'COMPLETED'::text, 'CLAIMED'::text, 'EXPIRED'::text]))),
    CONSTRAINT gift_trees_gift_item_id_fkey FOREIGN KEY (gift_item_id) REFERENCES public.gift_items(id)
);
CREATE INDEX IF NOT EXISTS idx_gift_trees_pickup_code ON public.gift_trees USING btree (pickup_code) WHERE (pickup_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_gift_trees_user ON public.gift_trees USING btree (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_trees_user_growing ON public.gift_trees USING btree (user_id) WHERE (status = 'GROWING'::text);

-- ============================================================
-- Table: public.gift_tree_tasks（任务定义）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gift_tree_tasks (
    task_code text NOT NULL,
    category text DEFAULT 'DAILY'::text NOT NULL,
    title_i18n jsonb DEFAULT '{}'::jsonb NOT NULL,
    description_i18n jsonb DEFAULT '{}'::jsonb,
    reward_water integer NOT NULL,
    daily_limit integer DEFAULT 1 NOT NULL,
    action_route text,
    action_label_i18n jsonb DEFAULT '{}'::jsonb,
    min_amount numeric,
    require_real_payment boolean DEFAULT false,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT gift_tree_tasks_pkey PRIMARY KEY (task_code),
    CONSTRAINT gift_tree_tasks_category_check CHECK ((category = ANY (ARRAY['ONETIME'::text, 'DAILY'::text, 'SOCIAL'::text, 'RANDOM'::text]))),
    CONSTRAINT gift_tree_tasks_daily_limit_check CHECK ((daily_limit >= 0)),
    CONSTRAINT gift_tree_tasks_reward_water_check CHECK ((reward_water > 0))
);

-- ============================================================
-- Table: public.gift_tree_task_logs（浇水/任务流水）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gift_tree_task_logs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id text NOT NULL,
    tree_id uuid NOT NULL,
    task_code text NOT NULL,
    water_earned integer NOT NULL,
    device_id text,
    ip_address inet,
    reference_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT gift_tree_task_logs_pkey PRIMARY KEY (id),
    CONSTRAINT gift_tree_task_logs_task_code_fkey FOREIGN KEY (task_code) REFERENCES public.gift_tree_tasks(task_code),
    CONSTRAINT gift_tree_task_logs_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES public.gift_trees(id)
);
CREATE INDEX IF NOT EXISTS idx_gift_task_logs_daily ON public.gift_tree_task_logs USING btree (user_id, task_code, public.to_date_immutable(created_at));
CREATE INDEX IF NOT EXISTS idx_gift_task_logs_device ON public.gift_tree_task_logs USING btree (device_id, public.to_date_immutable(created_at)) WHERE (device_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_gift_task_logs_tree_task ON public.gift_tree_task_logs USING btree (tree_id, task_code, public.to_date_immutable(created_at));
-- 幂等保护：reference_id 去重
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gift_task_logs_reference ON public.gift_tree_task_logs (reference_id) WHERE reference_id IS NOT NULL;

-- ============================================================
-- Table: public.gift_tree_help_logs（好友助力流水）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gift_tree_help_logs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    tree_id uuid NOT NULL,
    tree_owner_id text NOT NULL,
    helper_id text NOT NULL,
    helper_device_id text,
    helper_ip_address inet,
    water_earned integer NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT gift_tree_help_logs_pkey PRIMARY KEY (id),
    CONSTRAINT gift_tree_help_logs_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES public.gift_trees(id)
);
CREATE INDEX IF NOT EXISTS idx_gift_help_helper_daily ON public.gift_tree_help_logs USING btree (helper_id, public.to_date_immutable(created_at));
-- 防重复助力：同一 helper 对同一 tree 只能助力一次
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gift_help_helper_tree ON public.gift_tree_help_logs (helper_id, tree_id);

-- ============================================================
-- RLS Policies
-- 注意：所有读操作走 RPC（SECURITY DEFINER），SELECT 策略仅作为兜底；
-- 写操作不开启策略，强制走 RPC 通道，避免越权。
-- ============================================================
ALTER TABLE public.gift_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gift_items_select" ON public.gift_items;
CREATE POLICY "gift_items_select" ON public.gift_items AS PERMISSIVE FOR SELECT TO public USING (true);

ALTER TABLE public.gift_trees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gift_trees_select_own" ON public.gift_trees;
CREATE POLICY "gift_trees_select_own" ON public.gift_trees AS PERMISSIVE FOR SELECT TO public USING (true);

ALTER TABLE public.gift_tree_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gift_tree_tasks_select" ON public.gift_tree_tasks;
CREATE POLICY "gift_tree_tasks_select" ON public.gift_tree_tasks AS PERMISSIVE FOR SELECT TO public USING (true);

ALTER TABLE public.gift_tree_task_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gift_tree_task_logs_select" ON public.gift_tree_task_logs;
CREATE POLICY "gift_tree_task_logs_select" ON public.gift_tree_task_logs AS PERMISSIVE FOR SELECT TO public USING (true);

ALTER TABLE public.gift_tree_help_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gift_tree_help_logs_select" ON public.gift_tree_help_logs;
CREATE POLICY "gift_tree_help_logs_select" ON public.gift_tree_help_logs AS PERMISSIVE FOR SELECT TO public USING (true);

-- ============================================================
-- Function: rpc_get_gift_tree_status
-- 拉取当前用户的树状态、任务列表、今日流水汇总。
-- 返回结构（jsonb）:
--   { has_tree, cooldown_active, tree, tasks, today_logs, today_total_water, daily_limit }
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

    SELECT gt.*, gi.name, gi.name_i18n, gi.image_url, gi.image_urls, gi.description, gi.description_i18n
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
                'description_i18n', v_tree.description_i18n
            )
        );
    ELSE
        SELECT gt.*, gi.name, gi.name_i18n, gi.image_url, gi.image_urls, gi.description, gi.description_i18n
        INTO v_tree
        FROM public.gift_trees gt
        LEFT JOIN public.gift_items gi ON gt.gift_item_id = gi.id
        WHERE gt.user_id = v_user_id AND gt.status = 'COMPLETED'
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
                    'description_i18n', v_tree.description_i18n
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

    IF v_tree IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'task_code', sub.task_code,
                'count', sub.cnt,
                'total_water', sub.total_w
            )
        ), '[]'::jsonb) INTO v_today_logs
        FROM (
            SELECT task_code, COUNT(*) as cnt, SUM(water_earned) as total_w
            FROM public.gift_tree_task_logs
            WHERE tree_id = v_tree.id AND created_at::date = CURRENT_DATE
            GROUP BY task_code
        ) sub;

        SELECT COALESCE(SUM(water_earned), 0) INTO v_today_total
        FROM public.gift_tree_task_logs
        WHERE user_id = v_user_id AND tree_id = v_tree.id AND created_at::date = CURRENT_DATE;
    ELSE
        v_today_logs := '[]'::jsonb;
        v_today_total := 0;
    END IF;

    RETURN jsonb_build_object(
        'has_tree', v_has_tree,
        'cooldown_active', v_cooldown_active,
        'tree', v_tree_json,
        'tasks', v_tasks,
        'today_logs', v_today_logs,
        'today_total_water', v_today_total,
        'daily_limit', 180
    );
END;
$function$;

-- ============================================================
-- Function: rpc_start_gift_tree
-- 选择礼物开始育树。冷却期/已有树检查、库存预占、自动完成 FIRST_WATER 任务。
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_start_gift_tree(p_session_token text, p_gift_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user_id text;
    v_gift_item record;
    v_tree_id uuid;
    v_existing_tree record;
BEGIN
    SELECT user_id INTO v_user_id
    FROM public.user_sessions
    WHERE session_token = p_session_token AND expires_at > now();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_SESSION: Please login first';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.gift_trees
        WHERE user_id = v_user_id AND cooldown_until > now()
    ) THEN
        RAISE EXCEPTION 'ERR_COOLDOWN: Cooldown period active, please wait';
    END IF;

    SELECT * INTO v_existing_tree
    FROM public.gift_trees
    WHERE user_id = v_user_id AND status = 'GROWING';
    IF v_existing_tree IS NOT NULL THEN
        RAISE EXCEPTION 'ERR_ALREADY_GROWING: You already have a growing tree';
    END IF;

    SELECT * INTO v_existing_tree
    FROM public.gift_trees
    WHERE user_id = v_user_id AND status = 'COMPLETED';
    IF v_existing_tree IS NOT NULL THEN
        RAISE EXCEPTION 'ERR_UNCLAIMED: Please claim your completed tree gift first';
    END IF;

    SELECT * INTO v_gift_item
    FROM public.gift_items
    WHERE id = p_gift_item_id AND is_active = true
    FOR UPDATE;

    IF v_gift_item IS NULL THEN
        RAISE EXCEPTION 'ERR_GIFT_NOT_FOUND: Gift item not found or inactive';
    END IF;

    IF (v_gift_item.stock - v_gift_item.reserved_stock) <= 0 THEN
        RAISE EXCEPTION 'ERR_OUT_OF_STOCK: Gift item is out of stock';
    END IF;

    v_tree_id := uuid_generate_v4();

    INSERT INTO public.gift_trees (id, user_id, gift_item_id, target_water)
    VALUES (v_tree_id, v_user_id, p_gift_item_id, v_gift_item.target_water);

    UPDATE public.gift_items
    SET reserved_stock = reserved_stock + 1, updated_at = now()
    WHERE id = p_gift_item_id;

    INSERT INTO public.gift_tree_task_logs (user_id, tree_id, task_code, water_earned, reference_id)
    VALUES (v_user_id, v_tree_id, 'FIRST_WATER', 50, 'first_water_' || v_tree_id::text);

    UPDATE public.gift_trees
    SET current_water = 50, updated_at = now()
    WHERE id = v_tree_id;

    RETURN jsonb_build_object(
        'success', true,
        'tree_id', v_tree_id,
        'initial_water', 50
    );
END;
$function$;

-- ============================================================
-- Function: rpc_water_tree_internal
-- 浇水核心实现：任务校验、限流、奖励计算、里程碑、完成态切换。
-- 仅由 rpc_water_tree / rpc_gift_tree_friend_help 调用。
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_water_tree_internal(
    p_user_id text,
    p_tree_id uuid,
    p_task_code text,
    p_device_id text,
    p_reference_id text,
    p_metadata jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_task record;
    v_tree record;
    v_today_task_count integer;
    v_today_total_water integer;
    v_today_device_count integer;
    v_reward integer;
    v_old_water integer;
    v_new_water integer;
    v_milestone_rewards jsonb := '[]'::jsonb;
    v_completed boolean := false;
    v_pickup_code text;
    v_daily_limit constant integer := 180;
    v_ip inet;
BEGIN
    BEGIN
        v_ip := inet(current_setting('request.headers', true)::json->>'x-forwarded-for');
    EXCEPTION WHEN OTHERS THEN
        v_ip := NULL;
    END;

    SELECT * INTO v_task FROM public.gift_tree_tasks WHERE task_code = p_task_code AND is_active = true;
    IF v_task IS NULL THEN
        RAISE EXCEPTION 'ERR_TASK_INVALID: Task does not exist or is disabled';
    END IF;

    SELECT * INTO v_tree FROM public.gift_trees WHERE id = p_tree_id FOR UPDATE;
    IF v_tree IS NULL OR v_tree.status != 'GROWING' THEN
        RAISE EXCEPTION 'ERR_TREE_INVALID: Tree does not exist or is not growing';
    END IF;

    -- 幂等保护
    IF p_reference_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.gift_tree_task_logs WHERE reference_id = p_reference_id) THEN
            RETURN jsonb_build_object('success', true, 'duplicate', true, 'water_earned', 0,
                'old_water', v_tree.current_water, 'new_water', v_tree.current_water,
                'target_water', v_tree.target_water, 'milestone_rewards', '[]'::jsonb,
                'completed', false, 'pickup_code', null);
        END IF;
    END IF;

    IF v_task.daily_limit > 0 THEN
        SELECT COUNT(*) INTO v_today_task_count
        FROM public.gift_tree_task_logs
        WHERE user_id = p_user_id AND task_code = p_task_code AND created_at::date = CURRENT_DATE;

        IF v_today_task_count >= v_task.daily_limit THEN
            RAISE EXCEPTION 'ERR_DAILY_LIMIT: Daily limit reached for this task';
        END IF;
    END IF;

    SELECT COALESCE(SUM(water_earned), 0) INTO v_today_total_water
    FROM public.gift_tree_task_logs
    WHERE user_id = p_user_id AND tree_id = p_tree_id AND created_at::date = CURRENT_DATE;

    v_reward := v_task.reward_water;

    IF p_task_code = 'PLAY_LOTTERY' AND p_device_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_today_device_count
        FROM public.gift_tree_task_logs
        WHERE device_id = p_device_id
          AND task_code = 'PLAY_LOTTERY'
          AND created_at::date = CURRENT_DATE;
        IF v_today_device_count >= 5 THEN
            RAISE EXCEPTION 'ERR_DEVICE_LIMIT: Device operation frequency abnormal';
        END IF;
    END IF;

    IF v_tree.current_water >= (v_tree.target_water * 0.9) AND v_task.category != 'ONETIME' THEN
        v_reward := v_reward + 2;
    END IF;

    IF v_task.category != 'ONETIME' THEN
        IF v_today_total_water >= v_daily_limit THEN
            RAISE EXCEPTION 'ERR_DAILY_TOTAL_LIMIT: Daily water limit reached';
        END IF;
        IF (v_today_total_water + v_reward) > v_daily_limit THEN
            v_reward := v_daily_limit - v_today_total_water;
        END IF;
    END IF;

    v_old_water := v_tree.current_water;
    v_new_water := v_old_water + v_reward;

    IF v_new_water > v_tree.target_water THEN
        v_new_water := v_tree.target_water;
        v_reward := v_new_water - v_old_water;
    END IF;

    INSERT INTO public.gift_tree_task_logs (user_id, tree_id, task_code, water_earned, device_id, ip_address, reference_id, metadata)
    VALUES (p_user_id, p_tree_id, p_task_code, v_reward, p_device_id, v_ip, p_reference_id, p_metadata);

    UPDATE public.gift_trees
    SET current_water = v_new_water, updated_at = now()
    WHERE id = p_tree_id;

    -- Milestone：200 / 500 / 800
    IF v_old_water < 200 AND v_new_water >= 200 AND NOT v_tree.milestone_200_claimed THEN
        BEGIN
            PERFORM public.add_bonus_balance(p_user_id, 1, 'GIFT_TREE_MILESTONE_200');
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
        UPDATE public.gift_trees SET milestone_200_claimed = true WHERE id = p_tree_id;
        v_milestone_rewards := v_milestone_rewards || jsonb_build_object('milestone', 200, 'reward_type', 'bonus_balance', 'amount', 1);
    END IF;

    IF v_old_water < 500 AND v_new_water >= 500 AND NOT v_tree.milestone_500_claimed THEN
        BEGIN
            PERFORM public.add_bonus_balance(p_user_id, 2, 'GIFT_TREE_MILESTONE_500');
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
        UPDATE public.gift_trees SET milestone_500_claimed = true WHERE id = p_tree_id;
        v_milestone_rewards := v_milestone_rewards || jsonb_build_object('milestone', 500, 'reward_type', 'bonus_balance', 'amount', 2);
    END IF;

    IF v_old_water < 800 AND v_new_water >= 800 AND NOT v_tree.milestone_800_claimed THEN
        UPDATE public.gift_trees SET milestone_800_claimed = true WHERE id = p_tree_id;
        v_milestone_rewards := v_milestone_rewards || jsonb_build_object('milestone', 800, 'reward_type', 'coupon', 'amount', 1);
    END IF;

    -- 完成态切换 + 8 位取货码 + 15 天有效期
    IF v_new_water >= v_tree.target_water THEN
        v_pickup_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
        LOOP
            EXIT WHEN NOT EXISTS (SELECT 1 FROM public.gift_trees WHERE pickup_code = v_pickup_code);
            v_pickup_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
        END LOOP;

        UPDATE public.gift_trees
        SET status = 'COMPLETED',
            pickup_code = v_pickup_code,
            pickup_code_expires_at = now() + interval '15 days',
            updated_at = now()
        WHERE id = p_tree_id;

        v_completed := true;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'water_earned', v_reward,
        'old_water', v_old_water,
        'new_water', v_new_water,
        'target_water', v_tree.target_water,
        'milestone_rewards', v_milestone_rewards,
        'completed', v_completed,
        'pickup_code', v_pickup_code
    );
END;
$function$;

-- ============================================================
-- Function: rpc_water_tree（用户主动浇水入口）
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

    RETURN public.rpc_water_tree_internal(
        v_user_id, v_tree.id, p_task_code, p_device_id, p_reference_id, p_metadata
    );
END;
$function$;

-- ============================================================
-- Function: rpc_gift_tree_friend_help（好友助力）
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_gift_tree_friend_help(
    p_session_token text,
    p_tree_owner_id text,
    p_device_id text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_helper_id text;
    v_tree record;
    v_today_help_count integer;
    v_task record;
    v_result jsonb;
BEGIN
    SELECT user_id INTO v_helper_id
    FROM public.user_sessions
    WHERE session_token = p_session_token AND expires_at > now();
    IF v_helper_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_SESSION: Please login first';
    END IF;

    IF v_helper_id = p_tree_owner_id THEN
        RAISE EXCEPTION 'ERR_SELF_HELP: Cannot help yourself';
    END IF;

    SELECT * INTO v_tree
    FROM public.gift_trees
    WHERE user_id = p_tree_owner_id AND status = 'GROWING'
    FOR UPDATE;
    IF v_tree IS NULL THEN
        RAISE EXCEPTION 'ERR_NO_TREE: User has no growing tree';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.gift_tree_help_logs
        WHERE tree_id = v_tree.id AND helper_id = v_helper_id
    ) THEN
        RAISE EXCEPTION 'ERR_ALREADY_HELPED: Already helped this tree';
    END IF;

    SELECT COUNT(*) INTO v_today_help_count
    FROM public.gift_tree_help_logs
    WHERE helper_id = v_helper_id AND created_at::date = CURRENT_DATE;
    IF v_today_help_count >= 3 THEN
        RAISE EXCEPTION 'ERR_HELP_LIMIT: Daily help limit reached';
    END IF;

    SELECT * INTO v_task FROM public.gift_tree_tasks WHERE task_code = 'FRIEND_HELP';

    INSERT INTO public.gift_tree_help_logs (tree_id, tree_owner_id, helper_id, helper_device_id, water_earned)
    VALUES (v_tree.id, p_tree_owner_id, v_helper_id, p_device_id, COALESCE(v_task.reward_water, 15));

    v_result := public.rpc_water_tree_internal(
        p_tree_owner_id, v_tree.id, 'FRIEND_HELP', p_device_id,
        'help_' || v_helper_id || '_' || v_tree.id::text,
        jsonb_build_object('helper_id', v_helper_id)
    );

    RETURN v_result;
END;
$function$;

-- ============================================================
-- Function: rpc_claim_gift_tree（管理员核销取货）
-- 注意：使用 admin_sessions 进行身份校验，前台用户不应直接调用。
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_claim_gift_tree(
    p_session_token text,
    p_pickup_code text,
    p_pickup_point_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_admin_id text;
    v_tree record;
BEGIN
    SELECT id::text INTO v_admin_id
    FROM public.admin_sessions
    WHERE session_token = p_session_token AND expires_at > now();
    IF v_admin_id IS NULL THEN
        SELECT admin_id::text INTO v_admin_id
        FROM public.admin_sessions
        WHERE session_token = p_session_token;
        IF v_admin_id IS NULL THEN
            RAISE EXCEPTION 'ERR_ADMIN_AUTH: Admin authentication failed';
        END IF;
    END IF;

    SELECT * INTO v_tree
    FROM public.gift_trees
    WHERE pickup_code = upper(p_pickup_code)
    FOR UPDATE;

    IF v_tree IS NULL THEN
        RAISE EXCEPTION 'ERR_CODE_NOT_FOUND: Pickup code not found';
    END IF;
    IF v_tree.status = 'CLAIMED' THEN
        RAISE EXCEPTION 'ERR_ALREADY_CLAIMED: Gift already claimed';
    END IF;
    IF v_tree.status != 'COMPLETED' THEN
        RAISE EXCEPTION 'ERR_NOT_COMPLETED: Tree not completed yet';
    END IF;
    IF v_tree.pickup_code_expires_at < now() THEN
        RAISE EXCEPTION 'ERR_CODE_EXPIRED: Pickup code expired';
    END IF;

    UPDATE public.gift_trees
    SET status = 'CLAIMED',
        claimed_at = now(),
        pickup_point_id = COALESCE(p_pickup_point_id, pickup_point_id),
        cooldown_until = now() + interval '24 hours',
        updated_at = now()
    WHERE id = v_tree.id;

    UPDATE public.gift_items
    SET stock = stock - 1,
        reserved_stock = GREATEST(reserved_stock - 1, 0),
        updated_at = now()
    WHERE id = v_tree.gift_item_id;

    RETURN jsonb_build_object('success', true, 'tree_id', v_tree.id, 'user_id', v_tree.user_id);
END;
$function$;

-- ============================================================
-- 函数权限授予
-- ============================================================
GRANT EXECUTE ON FUNCTION public.rpc_get_gift_tree_status(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_start_gift_tree(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_water_tree(text, text, text, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_water_tree_internal(text, uuid, text, text, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_gift_tree_friend_help(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_claim_gift_tree(text, text, uuid) TO anon, authenticated, service_role;

-- ============================================================
-- 种子数据：任务定义（10 条）
-- ============================================================
INSERT INTO public.gift_tree_tasks
    (task_code, category, title_i18n, description_i18n, reward_water, daily_limit, action_route, action_label_i18n, min_amount, require_real_payment, is_active, sort_order)
VALUES
    ('FIRST_WATER', 'ONETIME',
     '{"zh":"首次浇水","ru":"Первый полив","tg":"Аввалин обёрӣ"}'::jsonb,
     '{"zh":"选择礼物开始种树","ru":"Выберите подарок","tg":"Тӯҳфа интихоб кунед"}'::jsonb,
     50, 1, NULL, '{}'::jsonb, NULL, false, true, 1),

    ('FIRST_LOTTERY', 'ONETIME',
     '{"zh":"首次夺宝","ru":"Первый розыгрыш","tg":"Аввалин бахтозмоӣ"}'::jsonb,
     '{"zh":"首次参与一元夺宝","ru":"Участвуйте впервые","tg":"Бори аввал иштирок кунед"}'::jsonb,
     50, 1, '/lottery',
     '{"zh":"去夺宝","ru":"Участвовать","tg":"Иштирок кунед"}'::jsonb,
     NULL, false, true, 2),

    ('DAILY_CHECKIN', 'DAILY',
     '{"zh":"每日签到","ru":"Ежедневная отметка","tg":"Қайди ҳаррӯза"}'::jsonb,
     '{"zh":"每天来浇水签到","ru":"Заходите каждый день","tg":"Ҳар рӯз ворид шавед"}'::jsonb,
     10, 1, NULL, '{}'::jsonb, NULL, false, true, 10),

    ('BROWSE_PRODUCTS', 'DAILY',
     '{"zh":"浏览商品","ru":"Просмотр товаров","tg":"Дидани молҳо"}'::jsonb,
     '{"zh":"浏览3个商品详情页","ru":"Просмотрите 3 товара","tg":"3 маҳсулотро бинед"}'::jsonb,
     15, 1, '/lottery',
     '{"zh":"去逛逛","ru":"Смотреть","tg":"Дидан"}'::jsonb,
     NULL, false, true, 11),

    ('PLAY_LOTTERY', 'DAILY',
     '{"zh":"参与夺宝","ru":"Участие в розыгрыше","tg":"Иштирок дар бахтозмоӣ"}'::jsonb,
     '{"zh":"购买夺宝门票","ru":"Купите билет","tg":"Билет харед"}'::jsonb,
     20, 3, '/lottery',
     '{"zh":"去夺宝","ru":"Участвовать","tg":"Иштирок"}'::jsonb,
     NULL, false, true, 20),

    ('WALLET_DEPOSIT', 'DAILY',
     '{"zh":"钱包充值","ru":"Пополнение кошелька","tg":"Пуркунии ҳамён"}'::jsonb,
     '{"zh":"充值≥10TJS","ru":"Пополните ≥10TJS","tg":"≥10TJS пур кунед"}'::jsonb,
     30, 2, '/wallet/deposit',
     '{"zh":"去充值","ru":"Пополнить","tg":"Пур кунед"}'::jsonb,
     10, false, true, 21),

    ('COMPLETE_ORDER', 'DAILY',
     '{"zh":"完成订单","ru":"Завершить заказ","tg":"Фармоиш иҷро кунед"}'::jsonb,
     '{"zh":"完成≥20TJS订单","ru":"Заказ ≥20TJS","tg":"Фармоиши ≥20TJS"}'::jsonb,
     40, 1, '/lottery',
     '{"zh":"去购物","ru":"Купить","tg":"Харид"}'::jsonb,
     20, true, true, 22),

    ('STORE_PICKUP', 'DAILY',
     '{"zh":"门店自提","ru":"Самовывоз","tg":"Аз мағоза гиред"}'::jsonb,
     '{"zh":"到Korvon门店自提","ru":"Заберите в Korvon","tg":"Аз Корвон гиред"}'::jsonb,
     30, 1, NULL, '{}'::jsonb, NULL, false, true, 23),

    ('FRIEND_HELP', 'SOCIAL',
     '{"zh":"好友助力","ru":"Помощь друга","tg":"Кӯмаки дӯст"}'::jsonb,
     '{"zh":"邀请好友助力浇水","ru":"Пригласите друга","tg":"Дӯстро даъват кунед"}'::jsonb,
     15, 2, NULL,
     '{"zh":"邀请好友","ru":"Пригласить","tg":"Даъват"}'::jsonb,
     NULL, false, true, 30),

    ('RANDOM_TASK', 'RANDOM',
     '{"zh":"惊喜任务","ru":"Сюрприз задание","tg":"Вазифаи ғайричашмдошт"}'::jsonb,
     '{"zh":"完成今日惊喜任务","ru":"Выполните задание","tg":"Вазифаро иҷро кунед"}'::jsonb,
     10, 1, NULL, '{}'::jsonb, NULL, false, true, 40)
ON CONFLICT (task_code) DO UPDATE
SET category = EXCLUDED.category,
    title_i18n = EXCLUDED.title_i18n,
    description_i18n = EXCLUDED.description_i18n,
    reward_water = EXCLUDED.reward_water,
    daily_limit = EXCLUDED.daily_limit,
    action_route = EXCLUDED.action_route,
    action_label_i18n = EXCLUDED.action_label_i18n,
    min_amount = EXCLUDED.min_amount,
    require_real_payment = EXCLUDED.require_real_payment,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order;

-- ============================================================
-- 种子数据：示例礼物（仅当表为空时插入，避免覆盖运营配置）
-- ============================================================
INSERT INTO public.gift_items
    (name, name_i18n, description, description_i18n, image_url, target_water, stock, value_tjs, is_active, sort_order)
SELECT * FROM (VALUES
    ('Premium Tea Set',
     '{"zh":"精品茶具套装","ru":"Премиум чайный набор","tg":"Маҷмӯаи чойникҳои олӣ"}'::jsonb,
     'High quality tea set',
     '{"zh":"高品质茶具套装","ru":"Высококачественный чайный набор","tg":"Маҷмӯаи чойникҳои сифатнок"}'::jsonb,
     'https://placehold.co/400x400/F5E6D3/333333?text=Tea+Set',
     1000, 50, 25::numeric, true, 1),
    ('Gift Box',
     '{"zh":"精美礼盒","ru":"Подарочная коробка","tg":"Қуттии тӯҳфа"}'::jsonb,
     'Beautiful gift box',
     '{"zh":"精美礼盒","ru":"Красивая подарочная коробка","tg":"Қуттии тӯҳфаи зебо"}'::jsonb,
     'https://placehold.co/400x400/FFE4B5/333333?text=Gift+Box',
     1000, 30, 20::numeric, true, 2),
    ('Lucky Gift Pack',
     '{"zh":"幸运礼包","ru":"Подарочный пакет удачи","tg":"Бастаи тӯҳфаи хушбахтӣ"}'::jsonb,
     'Lucky gift pack with surprises',
     '{"zh":"充满惊喜的幸运礼包","ru":"Подарочный пакет с сюрпризами","tg":"Бастаи тӯҳфа бо ғайричашмдоштҳо"}'::jsonb,
     'https://placehold.co/400x400/E8D5B7/333333?text=Lucky+Pack',
     1000, 20, 30::numeric, true, 3)
) AS v(name, name_i18n, description, description_i18n, image_url, target_water, stock, value_tjs, is_active, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.gift_items LIMIT 1);

-- ============================================================
-- 完成
-- ============================================================
