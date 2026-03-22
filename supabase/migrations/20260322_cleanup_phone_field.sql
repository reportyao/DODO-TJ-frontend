-- ============================================================
-- 清理废弃的 phone 字段
-- 日期: 2026-03-22
-- 说明: users 表中的 phone 列已完全被 phone_number 替代，
--       所有前端、后端、RPC函数均使用 phone_number，
--       删除 phone 列以消除技术债务和未来的混淆。
-- ============================================================

-- 【安全检查】确认 phone 列中没有 phone_number 缺失的独有数据
-- 如果存在 phone 有值但 phone_number 为空的记录，先同步数据
UPDATE users 
SET phone_number = REPLACE(REPLACE(phone, '+', ''), ' ', '')
WHERE phone IS NOT NULL 
  AND phone != '' 
  AND (phone_number IS NULL OR phone_number = '');

-- 【清理】删除废弃的 phone 列
ALTER TABLE users DROP COLUMN IF EXISTS phone;

-- 【清理】删除 phone 列上的索引（如果存在）
DROP INDEX IF EXISTS idx_users_phone;
DROP INDEX IF EXISTS users_phone_key;
DROP INDEX IF EXISTS users_phone_idx;
