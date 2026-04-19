create extension if not exists pgcrypto;

create table if not exists public.ai_listing_generation_tasks (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('processing', 'processing_images', 'done', 'partial', 'error')),
  request_payload jsonb,
  result_payload jsonb,
  error_message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ai_listing_generation_tasks_status_created_at
  on public.ai_listing_generation_tasks (status, created_at desc);

create index if not exists idx_ai_listing_generation_tasks_created_by_created_at
  on public.ai_listing_generation_tasks (created_by, created_at desc);
