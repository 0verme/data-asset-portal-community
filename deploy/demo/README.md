# Public Demo reset on the showcase host

The host-local 04:00 reset and 05:00 update remain the entry points. Both use
the existing exclusive lock on the same file. Keep that file in place during
operation so both jobs continue to lock the same inode.

## Prepare the host-local scripts

Use a reviewed checkout containing #600 and this change. Record the current
checkout revision, service state and script/helper versions. Save copies of the
host-local scripts and helper for rollback. Keep paths, config and output from
these checks on the host.

1. Confirm that the service's effective `ASSET_DB_PROFILE` is `public_demo`
   and its actual provider and database file agree with the reset job's
   effective config. Use the daemon's runtime settings and DAP's database
   resolver. The file must be the independently verified canonical absolute
   Demo database and a regular, singly linked file. Keep the database, config,
   helper and backup directories writable only by trusted deployment users.
   The reset assumes the stopped Demo service is the database writer.
2. Confirm the existing backup directory is writable by the Cron user and has
   space for the snapshot and rebuild. Confirm that user can stop/start the
   service using the existing passwordless systemctl commands.
3. Point the existing host-local `restore-personal-overrides.py` entry point
   at the corrected tracked helper with a symlink. Both the update and reset
   can then use the #600 version. The update's existing invocation uses the
   override file next to the symlink. Confirm the tracked helper is present in
   both the update target and its rollback revision before enabling the jobs.
4. In the host-local 04:00 script, move the existing local/public probes,
   read-only endpoint checks and login smoke into a `smoke_checks` function.
   Remove the old preflight, backup/prune, database removal, migration, seed,
   service control and rollback blocks. Keep the existing lock acquisition
   and log destination. Dispatch the smoke case before opening the lock.
   The existing `DB_FILE` supplies the explicit authorization below. Keep it
   independently configured from the runtime database YAML.

   ```bash
   if [ "${1:-}" = "--smoke" ]; then
     smoke_checks
     exit
   fi

   # Existing exec 9 and flock block goes here.
   exec "$PY" "$REPO/deploy/demo/reset-sqlite.py" \
     --authorized-database "$DB_FILE" \
     --backup-dir "$BACKUP_DIR" \
     --overrides "$OPS_DIR/personal-overrides.json" \
     -- "$0" --smoke >>"$LOG_FILE" 2>&1
   ```

   The helper requires the inherited lock on descriptor 9. It validates the
   target before stopping the service and again before replacing it, migrating,
   seeding and applying the RAG override. It stops writes, takes a standalone
   SQLite Backup API snapshot, verifies integrity and rebuilds at the existing
   path. The latest seven backups keep the existing database basename and
   timestamp naming convention. If a rebuild or probe fails, the helper
   stops the service before restoring the verified snapshot and clearing
   sidecars belonging to the failed rebuild. The job still reports failure
   after a successful recovery.

5. Keep the host-local 05:00 update's lock and Git/deploy flow. Add explicit
   returns for failed commands in the existing functions below. The rollback
   calls these functions in `if` conditions, where Bash suppresses
   `set -e` inside the function.

   In `restore_personal_overrides`, use the existing helper command with an
   explicit failure return before logging success.

   ```bash
   "$PY" "$OPS_DIR/restore-personal-overrides.py" || {
     log "FAILURE: stage=restore-personal-overrides"
     return 1
   }
   ```

   In `restart_and_verify`, retain the existing stage and success logs. Make
   the restart command and all three service/health conditions fail immediately.

   ```bash
   sudo -n /usr/bin/systemctl restart "$SERVICE" || return 1
   # Keep the existing startup wait and service-state log.
   [ "$active" = "active" ] || return 1
   # Keep the existing stage updates and success logs for each probe.
   probe_json "$HEALTH_LOCAL" || return 1
   probe_json "$HEALTH_PUBLIC" || return 1
   ```

## Release and rollback

Apply host changes only after approval. Use the existing shared lock for the
script/helper switch. Check both scripts with `bash -n`, verify the inherited
lock, helper target and runtime database, then let the scheduled jobs run.
Check the 04:00 log for Seed version 3, a verified backup, restored service and
`RESET_END: PASS`. After 05:00, check the update outcome, helper target and
service health. A full seed reset can restore custom AI quota and Branding
settings to defaults. Confirm acceptance or track restoration separately.

If the scheduled reset fails before replacement, the current database stays
in place. If it fails after replacement, check `ROLLBACK` and
`SERVICE_RECOVERY` before taking further action. For manual recovery after a
failed rollback or forced termination, hold the shared lock, confirm the
authorized database path and stop the service. Select a verified standalone
snapshot from the backup directory. Validate a staged copy with SQLite
`PRAGMA integrity_check`, remove the failed database's matching WAL, SHM and
rollback journal while the service is stopped, then atomically replace the
database with the staged copy. Restore its ownership and permissions and
verify service startup and the existing probes. To roll back the script
release, restore the saved host-local scripts and helper together under the
same lock. Keep 04:00 reset disabled if the fallback is the old destructive
script. Keep the fixed helper available to 05:00, or pause that job while
recovering the helper.
