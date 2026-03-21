-- Add phone_number column to error_logs table
-- Date: 2026-03-22
-- Reason: Error logs should include user's phone number for debugging
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);
