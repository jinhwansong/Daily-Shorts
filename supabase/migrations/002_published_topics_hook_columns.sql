-- 나레이션 훅(첫 줄) 및 썸네일 카피 — 회고·분석용
alter table public.published_topics add column if not exists hook_first_line text;
alter table public.published_topics add column if not exists thumbnail_line text;

comment on column public.published_topics.hook_first_line is '각본 첫 실질 문장([SECTION] 헤더 제외)';
comment on column public.published_topics.thumbnail_line is 'metadata.thumbnailLine 썸네일 카피(있으면)';
