# Security Remediation Checklist

Status: **OPEN** — created 2026-07-26 after a full repository audit.
Owner: repository administrator (`dead14`).

The repository history (pushed to GitHub) contained secrets and private data.
Untracking them (done in the `fix/comprehensive-audit` branch) removes them from
new commits only; **the blobs remain in history until the purge below is run,
and anything secret must be treated as leaked regardless.**

## 1. Rotate credentials — do this first, today

- [ ] **Chrome profile** — `.tmp-chrome/` contained `Login Data`, `Cookies`,
      `Web Data` for whatever accounts were used in that browser profile.
      Change the passwords of every account that was signed in there, and
      sign out all sessions (Google: myaccount.google.com → Security →
      Manage devices). Cookie theft bypasses passwords, so rotating sessions
      matters as much as rotating passwords.
- [ ] **`JWT_SECRET`** — a valid signed JWT was committed
      (`backend/data_samples/test_token.txt`, now deleted). Rotate
      `JWT_SECRET` in `/etc/synapse/production.env` and in every local
      `.env`. This invalidates all active user sessions — announce a
      re-login.
- [ ] **Database credentials** — `.codex/synapse-pgdata/` contained a full dev
      PostgreSQL data directory. If any real credentials or client data were
      loaded into that dev database, rotate the affected passwords
      (`DATABASE_URL` in both `.env` files) and assess the data exposure.
- [ ] **`backend/config76.json`** (10 MB, still in history) — inspect it:
      `git cat-file -p $(git rev-list --objects --all | grep config76 | cut -d' ' -f1)`
      and rotate anything it contains.
- [ ] **Client data** — `backend/db_exports/alignment_sessions.csv` (67 MB,
      still in history) likely contains real inspection data. Confirm with the
      data owner whether a disclosure obligation applies.

## 2. Purge git history

Run `scripts/maintenance/purge-git-history.sh` (instructions inside the
script). Expected effect: `.git` shrinks from ~130 MB to under ~10 MB and the
files above disappear from every commit. Requires a coordinated
`git push --force --mirror` and re-clones.

## 3. Prevent recurrence

- [ ] Enable **GitHub push protection + secret scanning**
      (repo Settings → Code security). Push protection would have blocked the
      committed JWT.
- [ ] Enable **Dependabot alerts** and add `github/codeql-action` for
      `javascript` and `python` (see `.github/workflows/`).
- [ ] Keep scratch work in `scratch/` (gitignored) instead of the repo root.
- [ ] Never run browsers or databases inside the repository directory.

## 4. Related hardening already applied on `fix/comprehensive-audit`

- Tracked junk removed from the index (7,949 → ~730 tracked files) and
  `.gitignore` extended (agent state dirs, template, archives, `scratch/`).
- Dead code deleted (`temp_controller.js`, `engine/db_writer.py`, scratch
  engines/scripts/tests, one-off frontend codemods).
- CI/deploy: Node runtime aligned (22), `persist-credentials: false`,
  strict release-id validation, explicit `StrictHostKeyChecking`,
  `PUBLIC_HOST` required from the environment (hardcoded production IP
  removed), PM2/Node paths overridable, old releases pruned automatically.
