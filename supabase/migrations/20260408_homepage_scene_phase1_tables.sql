-- ============================================================================
-- DODO 首页场景化改造 · 阶段 1 · 建表 + 索引 + RLS + 触发器
-- 日期: 2026-04-08
-- 说明: 新增一级分类、标签、商品关系、专题、投放、行为事件、AI任务、本地化词库
-- ============================================================================

-- ============================================================================
-- 0. 前置: 确保 update_updated_at_column 触发器函数存在
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. 一级分类主表 homepage_categories
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.homepage_categories (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text        UNIQUE NOT NULL,
    name_i18n       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    icon_key        text        NOT NULL DEFAULT '',
    color_token     text        NOT NULL DEFAULT '',
    sort_order      int         NOT NULL DEFAULT 0,
    is_active       boolean     NOT NULL DEFAULT true,
    is_fixed        boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.homepage_categories IS '首页一级分类主表';
COMMENT ON COLUMN public.homepage_categories.code IS '内部编码，如 daily_goods';
COMMENT ON COLUMN public.homepage_categories.name_i18n IS '三语名称 {zh, ru, tg}';
COMMENT ON COLUMN public.homepage_categories.icon_key IS '前台图标标识';
COMMENT ON COLUMN public.homepage_categories.color_token IS '前台金刚区色值方案';
COMMENT ON COLUMN public.homepage_categories.is_fixed IS '系统固定分类，防误删';

CREATE INDEX IF NOT EXISTS idx_categories_active_sort
    ON public.homepage_categories (is_active, sort_order);

CREATE TRIGGER trg_homepage_categories_updated_at
    BEFORE UPDATE ON public.homepage_categories
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.homepage_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to homepage_categories"
    ON public.homepage_categories FOR SELECT USING (true);

CREATE POLICY "Service role full access to homepage_categories"
    ON public.homepage_categories FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 2. 标签主表 homepage_tags
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.homepage_tags (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_group         text        NOT NULL,
    code              text        UNIQUE NOT NULL,
    name_i18n         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    description_i18n  jsonb       DEFAULT NULL,
    is_active         boolean     NOT NULL DEFAULT true,
    created_by        uuid        DEFAULT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_tag_group CHECK (
        tag_group IN ('scene','audience','festival','style','function','local')
    )
);

COMMENT ON TABLE  public.homepage_tags IS '首页标签主表';
COMMENT ON COLUMN public.homepage_tags.tag_group IS '标签组: scene/audience/festival/style/function/local';
COMMENT ON COLUMN public.homepage_tags.code IS '内部编码，全局唯一';
COMMENT ON COLUMN public.homepage_tags.name_i18n IS '三语标签名称 {zh, ru, tg}';

CREATE INDEX IF NOT EXISTS idx_tags_group_active
    ON public.homepage_tags (tag_group, is_active);

CREATE TRIGGER trg_homepage_tags_updated_at
    BEFORE UPDATE ON public.homepage_tags
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.homepage_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to homepage_tags"
    ON public.homepage_tags FOR SELECT USING (true);

CREATE POLICY "Service role full access to homepage_tags"
    ON public.homepage_tags FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 3. 商品-分类关系表 product_categories
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product_categories (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      uuid        NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
    category_id     uuid        NOT NULL REFERENCES public.homepage_categories(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_product_category UNIQUE (product_id, category_id)
);

COMMENT ON TABLE public.product_categories IS '商品-一级分类关系表';

CREATE INDEX IF NOT EXISTS idx_product_categories_category
    ON public.product_categories (category_id);

CREATE INDEX IF NOT EXISTS idx_product_categories_product
    ON public.product_categories (product_id);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to product_categories"
    ON public.product_categories FOR SELECT USING (true);

CREATE POLICY "Service role full access to product_categories"
    ON public.product_categories FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 4. 商品-标签关系表 product_tags
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product_tags (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      uuid        NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
    tag_id          uuid        NOT NULL REFERENCES public.homepage_tags(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_product_tag UNIQUE (product_id, tag_id)
);

COMMENT ON TABLE public.product_tags IS '商品-标签关系表';

CREATE INDEX IF NOT EXISTS idx_product_tags_tag
    ON public.product_tags (tag_id);

CREATE INDEX IF NOT EXISTS idx_product_tags_product
    ON public.product_tags (product_id);

ALTER TABLE public.product_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to product_tags"
    ON public.product_tags FOR SELECT USING (true);

CREATE POLICY "Service role full access to product_tags"
    ON public.product_tags FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 5. 专题主表 homepage_topics
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.homepage_topics (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_type              text        NOT NULL DEFAULT 'editorial',
    status                  text        NOT NULL DEFAULT 'draft',
    slug                    text        UNIQUE NOT NULL,
    title_i18n              jsonb       NOT NULL DEFAULT '{}'::jsonb,
    subtitle_i18n           jsonb       DEFAULT NULL,
    intro_i18n              jsonb       DEFAULT NULL,
    story_blocks_i18n       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    cover_image_default     text        DEFAULT NULL,
    cover_image_zh          text        DEFAULT NULL,
    cover_image_ru          text        DEFAULT NULL,
    cover_image_tg          text        DEFAULT NULL,
    theme_color             text        DEFAULT NULL,
    card_style              text        DEFAULT NULL,
    local_context_notes     text        DEFAULT NULL,
    source_type             text        NOT NULL DEFAULT 'manual',
    translation_status      jsonb       DEFAULT NULL,
    start_time              timestamptz DEFAULT NULL,
    end_time                timestamptz DEFAULT NULL,
    is_active               boolean     NOT NULL DEFAULT true,
    created_by              uuid        DEFAULT NULL,
    updated_by              uuid        DEFAULT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_topic_status CHECK (
        status IN ('draft','ready','published','offline')
    ),
    CONSTRAINT chk_topic_source_type CHECK (
        source_type IN ('manual','ai_draft','hybrid')
    )
);

COMMENT ON TABLE  public.homepage_topics IS '首页专题主表';
COMMENT ON COLUMN public.homepage_topics.topic_type IS '专题类型: editorial(内容型), 未来可扩展';
COMMENT ON COLUMN public.homepage_topics.slug IS '前台路由标识，如 winter-kitchen-essentials';
COMMENT ON COLUMN public.homepage_topics.story_blocks_i18n IS '三语正文块数组 [{block_key, block_type, zh, ru, tg}]';
COMMENT ON COLUMN public.homepage_topics.local_context_notes IS '本地化提示，仅后台可见';
COMMENT ON COLUMN public.homepage_topics.translation_status IS '三语审核状态 {zh: approved, ru: ai_draft, tg: ai_draft}';

CREATE INDEX IF NOT EXISTS idx_topics_status_time
    ON public.homepage_topics (status, is_active, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_topics_slug
    ON public.homepage_topics (slug);

CREATE TRIGGER trg_homepage_topics_updated_at
    BEFORE UPDATE ON public.homepage_topics
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.homepage_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to homepage_topics"
    ON public.homepage_topics FOR SELECT USING (true);

CREATE POLICY "Service role full access to homepage_topics"
    ON public.homepage_topics FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 6. 专题-商品关系表 topic_products
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.topic_products (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id        uuid        NOT NULL REFERENCES public.homepage_topics(id) ON DELETE CASCADE,
    product_id      uuid        NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
    sort_order      int         NOT NULL DEFAULT 0,
    note_i18n       jsonb       DEFAULT NULL,
    badge_text_i18n jsonb       DEFAULT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_topic_product UNIQUE (topic_id, product_id)
);

COMMENT ON TABLE  public.topic_products IS '专题-商品关系表';
COMMENT ON COLUMN public.topic_products.note_i18n IS '专题内商品场景说明 {zh, ru, tg}';
COMMENT ON COLUMN public.topic_products.badge_text_i18n IS '可选标签文案，如"适合待客" {zh, ru, tg}';

CREATE INDEX IF NOT EXISTS idx_topic_products_topic_sort
    ON public.topic_products (topic_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_topic_products_product
    ON public.topic_products (product_id);

CREATE TRIGGER trg_topic_products_updated_at
    BEFORE UPDATE ON public.topic_products
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.topic_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to topic_products"
    ON public.topic_products FOR SELECT USING (true);

CREATE POLICY "Service role full access to topic_products"
    ON public.topic_products FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 7. 专题投放表 topic_placements
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.topic_placements (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id                uuid        NOT NULL REFERENCES public.homepage_topics(id) ON DELETE CASCADE,
    placement_name          text        NOT NULL DEFAULT '',
    card_variant_name       text        DEFAULT NULL,
    title_i18n              jsonb       DEFAULT NULL,
    subtitle_i18n           jsonb       DEFAULT NULL,
    cover_image_default     text        DEFAULT NULL,
    cover_image_zh          text        DEFAULT NULL,
    cover_image_ru          text        DEFAULT NULL,
    cover_image_tg          text        DEFAULT NULL,
    feed_position           int         NOT NULL DEFAULT 0,
    sort_order              int         NOT NULL DEFAULT 0,
    is_active               boolean     NOT NULL DEFAULT true,
    start_time              timestamptz DEFAULT NULL,
    end_time                timestamptz DEFAULT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.topic_placements IS '专题投放表 - 控制专题卡在首页feed中的插入位置';
COMMENT ON COLUMN public.topic_placements.feed_position IS '插入到第几个商品槽位之后';
COMMENT ON COLUMN public.topic_placements.card_variant_name IS '卡面版本名，用于区分同一专题的不同投放卡面';

CREATE INDEX IF NOT EXISTS idx_placements_active_time_position
    ON public.topic_placements (is_active, start_time, end_time, feed_position, sort_order);

CREATE INDEX IF NOT EXISTS idx_placements_topic
    ON public.topic_placements (topic_id);

CREATE TRIGGER trg_topic_placements_updated_at
    BEFORE UPDATE ON public.topic_placements
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.topic_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to topic_placements"
    ON public.topic_placements FOR SELECT USING (true);

CREATE POLICY "Service role full access to topic_placements"
    ON public.topic_placements FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 8. 用户行为事件表 user_behavior_events
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_behavior_events (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        DEFAULT NULL,
    session_id      text        NOT NULL,
    event_name      text        NOT NULL,
    page_name       text        NOT NULL,
    entity_type     text        DEFAULT NULL,
    entity_id       text        DEFAULT NULL,
    position        text        DEFAULT NULL,
    -- 结构化归因字段（避免全部塞进 metadata）
    source_page     text        DEFAULT NULL,
    source_topic_id uuid        DEFAULT NULL,
    source_placement_id uuid    DEFAULT NULL,
    source_category_id uuid     DEFAULT NULL,
    lottery_id      text        DEFAULT NULL,
    inventory_product_id uuid   DEFAULT NULL,
    order_id        text        DEFAULT NULL,
    trace_id        text        DEFAULT NULL,
    -- 扩展与设备
    metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    device_info     jsonb       DEFAULT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.user_behavior_events IS '用户行为事件表 - 推荐与分析基础';
COMMENT ON COLUMN public.user_behavior_events.session_id IS '客户端生成的会话ID';
COMMENT ON COLUMN public.user_behavior_events.event_name IS '事件名: home_view, category_click, topic_card_click 等';
COMMENT ON COLUMN public.user_behavior_events.entity_type IS '事件对象类型: home/topic/product/category/banner/order';
COMMENT ON COLUMN public.user_behavior_events.position IS '位置标识，如 home_feed:6';
COMMENT ON COLUMN public.user_behavior_events.source_page IS '来源页面';
COMMENT ON COLUMN public.user_behavior_events.trace_id IS '链路追踪ID';

CREATE INDEX IF NOT EXISTS idx_behavior_event_name_time
    ON public.user_behavior_events (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_behavior_user_time
    ON public.user_behavior_events (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_behavior_entity
    ON public.user_behavior_events (entity_type, entity_id)
    WHERE entity_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_behavior_session
    ON public.user_behavior_events (session_id, created_at DESC);

ALTER TABLE public.user_behavior_events ENABLE ROW LEVEL SECURITY;

-- 行为事件: 匿名和已认证用户均可写入（通过 Edge Function 控制安全）
CREATE POLICY "Allow anon insert to user_behavior_events"
    ON public.user_behavior_events FOR INSERT TO anon
    WITH CHECK (true);

CREATE POLICY "Allow authenticated insert to user_behavior_events"
    ON public.user_behavior_events FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY "Service role full access to user_behavior_events"
    ON public.user_behavior_events FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 9. AI 专题生成任务表 ai_topic_generation_tasks
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_topic_generation_tasks (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    status          text        NOT NULL DEFAULT 'queued',
    topic_id        uuid        DEFAULT NULL REFERENCES public.homepage_topics(id) ON DELETE SET NULL,
    request_payload jsonb       NOT NULL DEFAULT '{}'::jsonb,
    result_payload  jsonb       DEFAULT NULL,
    error_message   text        DEFAULT NULL,
    created_by      uuid        DEFAULT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz DEFAULT NULL,

    CONSTRAINT chk_ai_task_status CHECK (
        status IN ('queued','processing','done','partial','error')
    )
);

COMMENT ON TABLE  public.ai_topic_generation_tasks IS 'AI专题生成任务表 - 后台AI生成流程管理';
COMMENT ON COLUMN public.ai_topic_generation_tasks.request_payload IS '生成输入: topic_goal, selected_products, target_audience 等';
COMMENT ON COLUMN public.ai_topic_generation_tasks.result_payload IS '生成输出: title_i18n, story_blocks_i18n, product_notes 等';

CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_time
    ON public.ai_topic_generation_tasks (status, created_at DESC);

CREATE TRIGGER trg_ai_topic_tasks_updated_at
    BEFORE UPDATE ON public.ai_topic_generation_tasks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ai_topic_generation_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to ai_topic_generation_tasks"
    ON public.ai_topic_generation_tasks FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================================
-- 10. 本地化词库表 localization_lexicon
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.localization_lexicon (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lexicon_group   text        NOT NULL,
    code            text        UNIQUE NOT NULL,
    title_i18n      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    content_i18n    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    example_i18n    jsonb       DEFAULT NULL,
    example_good    text        DEFAULT NULL,
    example_bad     text        DEFAULT NULL,
    local_anchors   text[]      DEFAULT NULL,
    tone_notes      text        DEFAULT NULL,
    is_active       boolean     NOT NULL DEFAULT true,
    sort_order      int         NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_lexicon_group CHECK (
        lexicon_group IN ('food','festival','family','gifting','home_scene','tone','taboo')
    )
);

COMMENT ON TABLE  public.localization_lexicon IS '本地化词库/文化库 - AI提示词增强与运营沉淀';
COMMENT ON COLUMN public.localization_lexicon.lexicon_group IS '词库组: food/festival/family/gifting/home_scene/tone/taboo';
COMMENT ON COLUMN public.localization_lexicon.example_good IS '好例子: 像人说话的文案示例';
COMMENT ON COLUMN public.localization_lexicon.example_bad IS '坏例子: 机器人套话示例';
COMMENT ON COLUMN public.localization_lexicon.local_anchors IS '本地生活锚点关键词数组';
COMMENT ON COLUMN public.localization_lexicon.tone_notes IS '口吻要求说明';

CREATE INDEX IF NOT EXISTS idx_lexicon_group_active_sort
    ON public.localization_lexicon (lexicon_group, is_active, sort_order);

CREATE TRIGGER trg_localization_lexicon_updated_at
    BEFORE UPDATE ON public.localization_lexicon
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.localization_lexicon ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to localization_lexicon"
    ON public.localization_lexicon FOR SELECT USING (true);

CREATE POLICY "Service role full access to localization_lexicon"
    ON public.localization_lexicon FOR ALL TO service_role
    USING (true) WITH CHECK (true);
