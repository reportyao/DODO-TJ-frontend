-- ============================================================================
-- 批发商资料：增加门店现场照片字段，并初始化 wholesaler-stores 存储桶
-- 日期: 2026-05-08
-- 关联需求: 管理后台批发商管理需要支持上传门店现场照片
-- ============================================================================

-- 1. 为 wholesaler_profiles 增加 store_photos 字段（存放公开 URL 数组）
ALTER TABLE wholesaler_profiles
  ADD COLUMN IF NOT EXISTS store_photos jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN wholesaler_profiles.store_photos IS '门店现场照片公开 URL 列表（jsonb 数组）。由管理后台调用 admin-upload-image 上传到 wholesaler-stores bucket 后写入。';

-- 2. 创建公开可读的 wholesaler-stores bucket（如果不存在）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wholesaler-stores',
  'wholesaler-stores',
  true,
  10 * 1024 * 1024,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3. RLS：允许所有人公开读取该 bucket 中的对象（保持与 lottery-images 等公共 bucket 一致）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'wholesaler_stores_public_read'
  ) THEN
    CREATE POLICY "wholesaler_stores_public_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'wholesaler-stores');
  END IF;
END $$;
