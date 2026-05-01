-- ============================================================
-- 批量上架助手：新增 understanding_only 控制位
-- ============================================================
--
-- 业务背景：
-- 批量上架助手目前由 batch-listing/processor.mjs 后台进程处理 batch_upload_items，
-- 默认仅做"AI 商品理解 + 入库 inventory_products / lotteries / product_categories"，
-- 不调用阿里云抠图（SegmentCommodity）也不调用海报生成（wanx-background-generation）。
--
-- 为了让运营在创建批次时显式声明意图（仅 AI 理解 vs 完整 AI 理解+抠图+海报生成），
-- 在 batch_upload_items 表与 batch_upload_tasks 表分别新增 understanding_only 字段：
--   - true（默认）：仅执行 AI 商品理解（视觉+文本两阶段大模型）→ 直接用上传的原图入库；
--   - false：未来扩展为完整流程（抠图 + 海报生成）。
--
-- 本迁移仅做字段新增 + 默认值兜底 + 索引更新，幂等执行。
-- ============================================================
ALTER TABLE batch_upload_tasks
  ADD COLUMN IF NOT EXISTS understanding_only BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN batch_upload_tasks.understanding_only IS
  '批次默认模式：true=仅AI商品理解（不抠图/不生成海报，使用原图入库）；false=完整AI理解+抠图+海报生成（未来扩展）';
ALTER TABLE batch_upload_items
  ADD COLUMN IF NOT EXISTS understanding_only BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN batch_upload_items.understanding_only IS
  '单商品模式：true=仅AI商品理解；false=完整AI理解+抠图+海报生成。继承自批次主表，子项可覆盖。';
-- 兜底：把已存在的历史数据（NULL 不可能，因为有 NOT NULL DEFAULT，但保留以防迁移环境）显式置 TRUE
UPDATE batch_upload_tasks SET understanding_only = TRUE WHERE understanding_only IS NULL;
UPDATE batch_upload_items SET understanding_only = TRUE WHERE understanding_only IS NULL;
