/**
 * DODO 首页场景化改造 · 前端类型定义
 *
 * 本文件定义首页改造涉及的所有新表类型、RPC 参数/返回类型、
 * 前端业务模型类型。与 supabase.ts 自动生成文件分离维护。
 *
 * 命名规范:
 * - 数据库行类型: Db{TableName}Row
 * - 插入类型: Db{TableName}Insert
 * - 更新类型: Db{TableName}Update
 * - 前端业务模型: {Name} (不带 Db 前缀)
 *
 * [v2 性能优化] HomeFeedProductData / HomeFeedBanner / HomeFeedCategory
 * 已与瘦身后的 rpc_get_home_feed 对齐，移除首屏不需要的字段。
 */

// ============================================================================
// 通用类型
// ============================================================================

/** 三语 i18n 对象 */
export interface I18nText {
  zh?: string;
  ru?: string;
  tg?: string;
}

/** 支持的语言 */
export type SupportedLang = 'zh' | 'ru' | 'tg';

/** 翻译审核状态 */
export interface TranslationStatus {
  zh?: 'approved' | 'ai_draft' | 'pending';
  ru?: 'approved' | 'ai_draft' | 'pending';
  tg?: 'approved' | 'ai_draft' | 'pending';
}

/** 正文块类型 */
export interface StoryBlock {
  block_key: string;
  block_type: 'heading' | 'paragraph' | 'image' | 'product_grid' | 'callout';
  zh?: string;
  ru?: string;
  tg?: string;
  image_url?: string;
  product_ids?: string[];
}

// ============================================================================
// 1. homepage_categories 一级分类
// ============================================================================

export interface DbHomepageCategoryRow {
  id: string;
  code: string;
  name_i18n: I18nText;
  icon_key: string;
  color_token: string;
  sort_order: number;
  is_active: boolean;
  is_fixed: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbHomepageCategoryInsert {
  id?: string;
  code: string;
  name_i18n: I18nText;
  icon_key?: string;
  color_token?: string;
  sort_order?: number;
  is_active?: boolean;
  is_fixed?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DbHomepageCategoryUpdate {
  code?: string;
  name_i18n?: I18nText;
  icon_key?: string;
  color_token?: string;
  sort_order?: number;
  is_active?: boolean;
  is_fixed?: boolean;
}

// ============================================================================
// 2. homepage_tags 标签
// ============================================================================

export type TagGroup = 'scene' | 'audience' | 'festival' | 'style' | 'function' | 'local';

export interface DbHomepageTagRow {
  id: string;
  tag_group: TagGroup;
  code: string;
  name_i18n: I18nText;
  description_i18n: I18nText | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbHomepageTagInsert {
  id?: string;
  tag_group: TagGroup;
  code: string;
  name_i18n: I18nText;
  description_i18n?: I18nText | null;
  is_active?: boolean;
  created_by?: string | null;
}

export interface DbHomepageTagUpdate {
  tag_group?: TagGroup;
  code?: string;
  name_i18n?: I18nText;
  description_i18n?: I18nText | null;
  is_active?: boolean;
}

// ============================================================================
// 3. product_categories 商品-分类关系
// ============================================================================

export interface DbProductCategoryRow {
  id: string;
  product_id: string;
  category_id: string;
  created_at: string;
}

// ============================================================================
// 4. product_tags 商品-标签关系
// ============================================================================

export interface DbProductTagRow {
  id: string;
  product_id: string;
  tag_id: string;
  created_at: string;
}

// ============================================================================
// 5. homepage_topics 专题
// ============================================================================

export type TopicStatus = 'draft' | 'ready' | 'published' | 'offline';
export type TopicSourceType = 'manual' | 'ai_draft' | 'hybrid';

export interface DbHomepageTopicRow {
  id: string;
  topic_type: string;
  status: TopicStatus;
  slug: string;
  title_i18n: I18nText;
  subtitle_i18n: I18nText | null;
  intro_i18n: I18nText | null;
  story_blocks_i18n: StoryBlock[];
  cover_image_default: string | null;
  cover_image_zh: string | null;
  cover_image_ru: string | null;
  cover_image_tg: string | null;
  /** v2: AI 生成的封面图 URL */
  cover_image_url: string | null;
  theme_color: string | null;
  card_style: string | null;
  local_context_notes: string | null;
  source_type: TopicSourceType;
  translation_status: TranslationStatus | null;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbHomepageTopicInsert {
  id?: string;
  topic_type?: string;
  status?: TopicStatus;
  slug: string;
  title_i18n: I18nText;
  subtitle_i18n?: I18nText | null;
  intro_i18n?: I18nText | null;
  story_blocks_i18n?: StoryBlock[];
  cover_image_default?: string | null;
  cover_image_zh?: string | null;
  cover_image_ru?: string | null;
  cover_image_tg?: string | null;
  /** v2: AI 生成的封面图 URL */
  cover_image_url?: string | null;
  theme_color?: string | null;
  card_style?: string | null;
  local_context_notes?: string | null;
  source_type?: TopicSourceType;
  translation_status?: TranslationStatus | null;
  start_time?: string | null;
  end_time?: string | null;
  is_active?: boolean;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface DbHomepageTopicUpdate {
  topic_type?: string;
  status?: TopicStatus;
  slug?: string;
  title_i18n?: I18nText;
  subtitle_i18n?: I18nText | null;
  intro_i18n?: I18nText | null;
  story_blocks_i18n?: StoryBlock[];
  cover_image_default?: string | null;
  cover_image_zh?: string | null;
  cover_image_ru?: string | null;
  cover_image_tg?: string | null;
  /** v2: AI 生成的封面图 URL */
  cover_image_url?: string | null;
  theme_color?: string | null;
  card_style?: string | null;
  local_context_notes?: string | null;
  source_type?: TopicSourceType;
  translation_status?: TranslationStatus | null;
  start_time?: string | null;
  end_time?: string | null;
  is_active?: boolean;
  updated_by?: string | null;
}

// ============================================================================
// 6. topic_products 专题-商品关系
// ============================================================================

export interface DbTopicProductRow {
  id: string;
  topic_id: string;
  product_id: string;
  sort_order: number;
  note_i18n: I18nText | null;
  badge_text_i18n: I18nText | null;
  /** v2: 段落分组序号 */
  story_group: number;
  /** v2: 该组的场景化文案 */
  story_text_i18n: I18nText | null;
  created_at: string;
  updated_at: string;
}

export interface DbTopicProductInsert {
  topic_id: string;
  product_id: string;
  sort_order?: number;
  note_i18n?: I18nText | null;
  badge_text_i18n?: I18nText | null;
  /** v2: 段落分组序号 */
  story_group?: number;
  /** v2: 该组的场景化文案 */
  story_text_i18n?: I18nText | null;
}

// ============================================================================
// 7. topic_placements 专题投放
// ============================================================================

export interface DbTopicPlacementRow {
  id: string;
  topic_id: string;
  placement_name: string;
  card_variant_name: string | null;
  title_i18n: I18nText | null;
  subtitle_i18n: I18nText | null;
  cover_image_default: string | null;
  cover_image_zh: string | null;
  cover_image_ru: string | null;
  cover_image_tg: string | null;
  feed_position: number;
  sort_order: number;
  is_active: boolean;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbTopicPlacementInsert {
  topic_id: string;
  placement_name?: string;
  card_variant_name?: string | null;
  title_i18n?: I18nText | null;
  subtitle_i18n?: I18nText | null;
  cover_image_default?: string | null;
  cover_image_zh?: string | null;
  cover_image_ru?: string | null;
  cover_image_tg?: string | null;
  feed_position?: number;
  sort_order?: number;
  is_active?: boolean;
  start_time?: string | null;
  end_time?: string | null;
}

export interface DbTopicPlacementUpdate {
  placement_name?: string;
  card_variant_name?: string | null;
  title_i18n?: I18nText | null;
  subtitle_i18n?: I18nText | null;
  cover_image_default?: string | null;
  cover_image_zh?: string | null;
  cover_image_ru?: string | null;
  cover_image_tg?: string | null;
  feed_position?: number;
  sort_order?: number;
  is_active?: boolean;
  start_time?: string | null;
  end_time?: string | null;
}

// ============================================================================
// 8. user_behavior_events 用户行为事件
// ============================================================================

export type BehaviorEventName =
  | 'home_view'
  | 'banner_click'
  | 'category_click'
  | 'topic_card_expose'
  | 'topic_card_click'
  | 'product_card_expose'
  | 'product_card_click'
  | 'topic_detail_view'
  | 'topic_product_click'
  | 'product_detail_view'
  | 'order_create'
  | 'order_pay_success'
  | 'order_complete';

export type BehaviorEntityType =
  | 'home'
  | 'banner'
  | 'category'
  | 'topic'
  | 'product'
  | 'order';

export interface DbUserBehaviorEventRow {
  id: string;
  user_id: string | null;
  session_id: string;
  event_name: BehaviorEventName;
  page_name: string;
  entity_type: BehaviorEntityType | null;
  entity_id: string | null;
  position: string | null;
  source_page: string | null;
  source_topic_id: string | null;
  source_placement_id: string | null;
  source_category_id: string | null;
  lottery_id: string | null;
  inventory_product_id: string | null;
  order_id: string | null;
  trace_id: string | null;
  metadata: Record<string, unknown>;
  device_info: Record<string, unknown> | null;
  created_at: string;
}

/** 客户端上报事件的 payload */
export interface TrackEventPayload {
  session_id: string;
  user_id?: string;
  event_name: BehaviorEventName;
  page_name: string;
  entity_type?: BehaviorEntityType;
  entity_id?: string;
  position?: string;
  source_page?: string;
  source_topic_id?: string;
  source_placement_id?: string;
  source_category_id?: string;
  lottery_id?: string;
  inventory_product_id?: string;
  order_id?: string;
  trace_id?: string;
  metadata?: Record<string, unknown>;
  device_info?: Record<string, unknown>;
}

// ============================================================================
// 9. ai_topic_generation_tasks AI 专题生成任务
// ============================================================================

export type AiTaskStatus = 'queued' | 'processing' | 'done' | 'partial' | 'error';

export interface DbAiTopicGenerationTaskRow {
  id: string;
  status: AiTaskStatus;
  topic_id: string | null;
  request_payload: Record<string, unknown>;
  result_payload: Record<string, unknown> | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ============================================================================
// 10. localization_lexicon 本地化词库
// ============================================================================

export type LexiconGroup =
  | 'food'
  | 'festival'
  | 'family'
  | 'gifting'
  | 'home_scene'
  | 'tone'
  | 'taboo';

export interface DbLocalizationLexiconRow {
  id: string;
  lexicon_group: LexiconGroup;
  code: string;
  title_i18n: I18nText;
  content_i18n: I18nText;
  example_i18n: I18nText | null;
  example_good: string | null;
  example_bad: string | null;
  local_anchors: string[] | null;
  tone_notes: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DbLocalizationLexiconInsert {
  lexicon_group: LexiconGroup;
  code: string;
  title_i18n: I18nText;
  content_i18n: I18nText;
  example_i18n?: I18nText | null;
  example_good?: string | null;
  example_bad?: string | null;
  local_anchors?: string[] | null;
  tone_notes?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

// ============================================================================
// RPC 参数与返回类型
// ============================================================================

/** rpc_get_home_feed 返回结构 */
export interface HomeFeedResponse {
  banners: HomeFeedBanner[];
  categories: HomeFeedCategory[];
  products: HomeFeedItem[];
  placements: HomeFeedItem[];
}

/**
 * [v2] Banner 类型：合并多语言图片字段
 * 前端 BannerCarousel 不再独立查询 banners 表，直接使用 feed 中的数据
 */
export interface HomeFeedBanner {
  id: string;
  title: string;
  image_url: string;
  image_url_zh: string | null;
  image_url_ru: string | null;
  image_url_tg: string | null;
  link_url: string | null;
  link_type: string;
  sort_order: number;
}

/**
 * [v2] Category 类型：移除 icon_key, color_token
 * 前端 CategoryGrid 通过 code 映射图标，不需要这两个字段
 */
export interface HomeFeedCategory {
  id: string;
  code: string;
  name_i18n: I18nText;
  sort_order: number;
}

export interface HomeFeedItem {
  type: 'product' | 'topic';
  item_id: string;
  data: HomeFeedProductData | HomeFeedTopicData;
}

/**
 * [v2] Product 类型：首屏字段瘦身
 * 移除：description_i18n, image_urls, full_purchase_enabled,
 *       full_purchase_price, period, draw_time, end_time
 * 这些字段仅在详情页使用，首屏卡片不需要
 */
export interface HomeFeedProductData {
  lottery_id: string;
  inventory_product_id: string;
  title_i18n: I18nText;
  image_url: string;
  original_price: number;
  ticket_price: number;
  total_tickets: number;
  sold_tickets: number;
  price_comparisons: unknown[];
  currency: string;
  status: string;
}

export interface HomeFeedTopicData {
  topic_id: string;
  placement_id: string;
  slug: string;
  title_i18n: I18nText;
  subtitle_i18n: I18nText | null;
  cover_image_default: string | null;
  cover_image_zh: string | null;
  cover_image_ru: string | null;
  cover_image_tg: string | null;
  /** v2: AI 生成的封面图 URL */
  cover_image_url: string | null;
  theme_color: string | null;
  card_style: string;
  card_variant_name: string | null;
  feed_position: number;
}

/** rpc_get_topic_detail 返回结构 */
export interface TopicDetailResponse {
  success: boolean;
  topic: TopicDetail | null;
  products: TopicProductItem[];
}

export interface TopicDetail {
  id: string;
  slug: string;
  topic_type: string;
  title_i18n: I18nText;
  subtitle_i18n: I18nText | null;
  intro_i18n: I18nText | null;
  story_blocks_i18n: StoryBlock[];
  cover_image_default: string | null;
  cover_image_zh: string | null;
  cover_image_ru: string | null;
  cover_image_tg: string | null;
  /** v2: AI 生成的封面图 URL */
  cover_image_url: string | null;
  theme_color: string | null;
  card_style: string | null;
  translation_status: TranslationStatus | null;
  start_time: string | null;
  end_time: string | null;
}

export interface TopicProductItem {
  sort_order: number;
  /** v2: 段落分组序号 */
  story_group: number;
  /** v2: 该组的场景化文案 */
  story_text_i18n: I18nText | null;
  note_i18n: I18nText | null;
  badge_text_i18n: I18nText | null;
  product_id: string;
  name_i18n: I18nText;
  description_i18n: I18nText;
  image_url: string;
  image_urls: string[];
  original_price: number;
  active_lottery: {
    lottery_id: string;
    ticket_price: number;
    total_tickets: number;
    sold_tickets: number;
    status: string;
    full_purchase_enabled: boolean;
    full_purchase_price: number | null;
    price_comparisons: unknown[];
    currency: string;
    draw_time: string | null;
    end_time: string | null;
  } | null;
}

/** rpc_admin_search_topic_products 返回结构 */
export interface AdminSearchProductsResponse {
  data: AdminSearchProductItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminSearchProductItem {
  id: string;
  name_i18n: I18nText;
  description_i18n: I18nText;
  image_url: string;
  image_urls: string[];
  original_price: number;
  status: string;
  sku: string;
  created_at: string;
  categories: { id: string; code: string; name_i18n: I18nText }[];
  tags: { id: string; code: string; tag_group: TagGroup; name_i18n: I18nText }[];
  active_lottery: {
    id: string;
    ticket_price: number;
    total_tickets: number;
    sold_tickets: number;
    status: string;
  } | null;
}
