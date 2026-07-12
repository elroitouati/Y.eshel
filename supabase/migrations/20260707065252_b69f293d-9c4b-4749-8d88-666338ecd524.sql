
-- documents table
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('standards','historical_quotes','technical_specs','general')),
  file_path text NOT NULL,
  file_type text NOT NULL,
  file_size bigint,
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  processed boolean NOT NULL DEFAULT false
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage documents"
  ON public.documents FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Active users read documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.status = 'active'
    )
  );

CREATE INDEX documents_category_idx ON public.documents(category);
CREATE INDEX documents_uploaded_at_idx ON public.documents(uploaded_at DESC);

-- storage.objects policies for knowledge base buckets (admin-only)
CREATE POLICY "Admins read knowledge files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id IN ('standards','historical_quotes','technical_specs','general')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins upload knowledge files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id IN ('standards','historical_quotes','technical_specs','general')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins update knowledge files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id IN ('standards','historical_quotes','technical_specs','general')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    bucket_id IN ('standards','historical_quotes','technical_specs','general')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins delete knowledge files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id IN ('standards','historical_quotes','technical_specs','general')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );
