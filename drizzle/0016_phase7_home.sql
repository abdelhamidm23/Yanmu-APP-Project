-- Phase 7: the owner's Home (spec §11.2, §11.3).
-- "Ask branches to call these families" on the Overdue tuition detail: the owner or company manager
-- leaves a follow-up issue for the branch with the account numbers to call (no amounts: the branch
-- manager does not see money). Owners do not create issues directly (drizzle/0013), so this is the one
-- way in, and it alerts the branch's managers.

CREATE OR REPLACE FUNCTION app_ask_to_call(p_branch uuid, p_title text, p_details text, p_demo boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_people uuid[];
BEGIN
  IF NOT app_has_role_in(p_branch, ARRAY['owner', 'company_manager']::app_role[]) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_title, ''))) < 3 OR length(p_title) > 200 OR length(coalesce(p_details, '')) > 4000 THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = '23514';
  END IF;
  INSERT INTO issue (branch_id, category, title, details, priority, is_demo)
  VALUES (p_branch, 'other', btrim(p_title), p_details, 'high', coalesce(p_demo, false))
  RETURNING id INTO v_id;
  SELECT coalesce(array_agg(p), '{}') INTO v_people FROM app_alert_people(p_branch, ARRAY['branch_manager']::app_role[]) p;
  PERFORM app_raise_alert(p_branch, 'issue_assigned', 'info', 'issue', v_id, format('issue:%s:call', v_id), v_people, coalesce(p_demo, false));
  RETURN v_id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_ask_to_call(uuid, text, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_ask_to_call(uuid, text, text, boolean) TO yanmu_app;
