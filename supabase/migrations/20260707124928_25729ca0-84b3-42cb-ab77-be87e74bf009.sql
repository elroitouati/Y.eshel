create or replace function public.match_document_chunks(
  query_embedding vector(1024),
  match_count int default 8
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  similarity float,
  title text,
  category text,
  file_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.document_id, c.chunk_text as content,
         1 - (c.embedding <=> query_embedding) as similarity,
         d.title, d.category::text, d.file_type
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_document_chunks(vector, int) to authenticated, service_role;