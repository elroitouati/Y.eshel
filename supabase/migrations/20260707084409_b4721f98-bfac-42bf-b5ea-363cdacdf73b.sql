-- Update documents category check constraint to all 17 categories
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_category_check
  CHECK (category IN (
    'commissioner_directives',
    'private_pool_safety',
    'objections',
    'server_room_guidelines',
    'organization_plan_materials',
    'financing_calculation',
    'educational_institutions',
    'inspection_institute_forms',
    'fire_risk_survey_procedure',
    'building_structure_classification',
    'fire_extinguishing_publications',
    'fire_risk_survey_course',
    'standards_institute_courses',
    'planning_building_regulations',
    'israeli_standards',
    'nfpa_standards',
    'sol_safety'
  ));

-- Recreate storage.objects policies with the updated bucket list (17 buckets)
DROP POLICY IF EXISTS "Admins read knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Admins upload knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Admins update knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete knowledge files" ON storage.objects;

CREATE POLICY "Admins read knowledge files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN (
      'commissioner_directives','private_pool_safety','objections','server_room_guidelines',
      'organization_plan_materials','financing_calculation','educational_institutions',
      'inspection_institute_forms','fire_risk_survey_procedure','building_structure_classification',
      'fire_extinguishing_publications','fire_risk_survey_course','standards_institute_courses',
      'planning_building_regulations','israeli_standards','nfpa_standards','sol_safety'
    )
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins upload knowledge files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN (
      'commissioner_directives','private_pool_safety','objections','server_room_guidelines',
      'organization_plan_materials','financing_calculation','educational_institutions',
      'inspection_institute_forms','fire_risk_survey_procedure','building_structure_classification',
      'fire_extinguishing_publications','fire_risk_survey_course','standards_institute_courses',
      'planning_building_regulations','israeli_standards','nfpa_standards','sol_safety'
    )
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins update knowledge files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN (
      'commissioner_directives','private_pool_safety','objections','server_room_guidelines',
      'organization_plan_materials','financing_calculation','educational_institutions',
      'inspection_institute_forms','fire_risk_survey_procedure','building_structure_classification',
      'fire_extinguishing_publications','fire_risk_survey_course','standards_institute_courses',
      'planning_building_regulations','israeli_standards','nfpa_standards','sol_safety'
    )
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    bucket_id IN (
      'commissioner_directives','private_pool_safety','objections','server_room_guidelines',
      'organization_plan_materials','financing_calculation','educational_institutions',
      'inspection_institute_forms','fire_risk_survey_procedure','building_structure_classification',
      'fire_extinguishing_publications','fire_risk_survey_course','standards_institute_courses',
      'planning_building_regulations','israeli_standards','nfpa_standards','sol_safety'
    )
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Admins delete knowledge files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN (
      'commissioner_directives','private_pool_safety','objections','server_room_guidelines',
      'organization_plan_materials','financing_calculation','educational_institutions',
      'inspection_institute_forms','fire_risk_survey_procedure','building_structure_classification',
      'fire_extinguishing_publications','fire_risk_survey_course','standards_institute_courses',
      'planning_building_regulations','israeli_standards','nfpa_standards','sol_safety'
    )
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );