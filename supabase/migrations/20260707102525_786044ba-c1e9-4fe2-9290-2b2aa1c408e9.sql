
create extension if not exists vector;

alter table public.documents
  add column if not exists processing_status text not null default 'pending',
  add column if not exists processing_error text,
  add column if not exists processed_at timestamptz;

update public.documents
  set processing_status = 'processed', processed_at = uploaded_at
  where processed = true and processing_status = 'pending';

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index int not null,
  chunk_text text not null,
  embedding vector(1024) not null,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

grant select on public.document_chunks to authenticated;
grant all on public.document_chunks to service_role;

alter table public.document_chunks enable row level security;

create policy "Admins manage document_chunks"
  on public.document_chunks
  for all
  to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Active users read document_chunks"
  on public.document_chunks
  for select
  to authenticated
  using (
    has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active'
    )
  );

create index if not exists document_chunks_document_id_idx
  on public.document_chunks (document_id);

create index if not exists document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding vector_cosine_ops);
