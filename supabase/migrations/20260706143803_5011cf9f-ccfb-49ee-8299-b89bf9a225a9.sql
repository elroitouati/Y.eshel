
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Check if user already exists
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'sharontouati@gmail.com';

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      'sharontouati@gmail.com',
      crypt('SY190858', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"שרון טואיטי"}'::jsonb,
      now(), now(),
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', 'sharontouati@gmail.com', 'email_verified', true),
      'email', v_user_id::text,
      now(), now(), now()
    );
  END IF;

  -- Ensure profile exists and is active
  INSERT INTO public.profiles (id, full_name, email, status)
  VALUES (v_user_id, 'שרון טואיטי', 'sharontouati@gmail.com', 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active', email = EXCLUDED.email;

  -- Grant admin role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Full permissions
  INSERT INTO public.user_permissions (user_id, can_projects, can_quotes, can_safety, can_assistant)
  VALUES (v_user_id, true, true, true, true)
  ON CONFLICT (user_id) DO UPDATE SET
    can_projects = true, can_quotes = true, can_safety = true, can_assistant = true;
END $$;
