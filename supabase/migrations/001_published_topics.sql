-- published_topics: 업로드 성공 이력 (append-only)
create table if not exists public.published_topics (
  id bigint generated always as identity primary key,
  genre_key text not null,
  topic_key text not null,
  uploaded_at timestamptz not null default now(),
  video_id text,
  raw_topic text
);

create index if not exists published_topics_genre_topic_uploaded_idx
  on public.published_topics (genre_key, topic_key, uploaded_at desc);

comment on table public.published_topics is 'YouTube 업로드 성공 시 기록; 6개월 중복 방지 조회용';
