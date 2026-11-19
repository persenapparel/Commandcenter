# Staging-only POS badge migration release order (not applied)
This ordered list is for Supabase project `naaqcspvbntzdtwuchrr` ONLY. Do not run on production or on the live customer site's database.

**Prerequisites**: Deploy a compatible cashier frontend to protected staging; verify the owner has an active staging register and that the new register-scoped UI callers and guest origin are configured correctly. Run the source SQL tests and confirm the staging-only project ID before each write. Coordinate all migrations as one reviewed release, not as unrelated partial applications.

1. `staging_owner_enroll_register_scope_20261119.sql` (#182)
2. `staging_credential_scoped_register_access_20261119.sql` (#183)
3. `staging_revoke_badge_shifts_on_register_denial_20261119.sql` (#187)
4. `staging_owner_badge_register_access_read_20261119.sql` (#193)
5. `staging_owner_badge_scoped_status_20261119.sql` (#194)
6. `staging_close_all_revoked_staff_handoffs_20261119.sql` (#204)
7. `staging_owner_paired_single_register_enrollment_20261119.sql` (#206; **combined-release fix: use `p_register_id` to retain the existing seven-argument overload and match cashier RPC parameter names**)
8. `staging_legacy_pending_activation_one_register_20261119.sql` (#210)
9. `staging_owner_grants_legacy_credential_ids_20261119.sql` (#215)
10. `staging_owner_grant_conflict_guard_20261119.sql` (#218)
11. `staging_owner_grant_revocation_credential_version_20261119.sql` (#221)

**Important**: Changing an existing Postgres function input argument name with `CREATE OR REPLACE FUNCTION` can fail; therefore this integrated #206 source keeps `p_register_id`. The older six-argument enrollment and broad user-ID grant RPCs must end with authenticated EXECUTE revoked. Do not restore them as a rollback shortcut.

**Release gate**: Run `pos/sql/staging_release_readiness_audit.sql` and require zero `BLOCKED` rows; independently review the five anon-callable legacy customer SECURITY DEFINER RPCs, enforce staging RLS/owner authorization, verify owned/non-owned grant deny tests, then test two distinct simulated cash checkouts and badge lock/unlock on the protected iPad. Confirm Epson cash-only drawer and receipt behavior physically before serving customers.

No SQL migration is applied merely by merging this source. A verified staging deployment and explicit DDL migration step are still required.
