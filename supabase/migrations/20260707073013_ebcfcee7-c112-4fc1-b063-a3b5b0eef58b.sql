-- Add nfpa_standards to the documents category check constraint
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_category_check
  CHECK (category IN (
    'general',
    'technical_specs',
    'historical_quotes',
    'commissioner_directives',
    'planning_building_regulations',
    'israeli_standards',
    'fire_service_objections',
    'nfpa_standards'
  ));

-- Recreate storage.objects policies with the updated bucket list (8 buckets)
DROP POLICY IF EXISTS "Admins read knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Admins upload knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Admins update knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete knowledge files" ON storage.objects;

CREATE POLICY "Admins read knowledge files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('general','technical_specs','historical_quotes','commissioner_directives','planning_building_regulations','israeli_standards','fire_service_objections','nfpa_standards')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins upload knowledge files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('general','technical_specs','historical_quotes','commissioner_directives','planning_building_regulations','israeli_standards','fire_service_objections','nfpa_standards')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins update knowledge files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('general','technical_specs','historical_quotes','commissioner_directives','planning_building_regulations','israeli_standards','fire_service_objections','nfpa_standards')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    bucket_id IN ('general','technical_specs','historical_quotes','commissioner_directives','planning_building_regulations','israeli_standards','fire_service_objections','nfpa_standards')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins delete knowledge files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('general','technical_specs','historical_quotes','commissioner_directives','planning_building_regulations','israeli_standards','fire_service_objections','nfpa_standards')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );