#!/usr/bin/env bash
# Monthly refresh: pull the export, make a snapshot, compare it with the last
# one, bring the FDA drug names up to date, rebuild the site and run every check. This script never publishes and
# never commits. The workflow publishes only when this script exits 0.
#
# Needs:
#   REFRESH_DATE   the day of the run, YYYY-MM-DD. When the export is fetched
#                  from HRSA, the day in the export's own file name is used
#                  instead, and the log says so if the two differ.
#   OPAIS_DIR      a checkout of the OPAIS library (run with uv)
#   SITE_DIR       a checkout of the site (defaults to the current folder)
# Optional:
#   REFRESH_STATE  two-letter state kept in the snapshot (default RI)
#   FDA_NDC_DIR    a folder that already holds the FDA directory's product.txt
#                  and package.txt; nothing is downloaded then
#   FORCE_FAILURE  "true" makes the run fail after every check has passed
#                  (the drill that proves a failure publishes nothing)
#
# Exit codes: 0 full pass; 3 unusual amount of change (a person must look);
# 4 no export; 5 no FDA directory; 9 forced failure; anything else, a check
# failed.
set -euo pipefail

: "${REFRESH_DATE:?set REFRESH_DATE to YYYY-MM-DD}"
: "${OPAIS_DIR:?set OPAIS_DIR to the OPAIS library checkout}"
SITE_DIR="${SITE_DIR:-$PWD}"
STATE="${REFRESH_STATE:-RI}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAP_DIR="$SITE_DIR/refresh/snapshots"
REPORT_DIR="$SITE_DIR/refresh/reports"

if [[ ! "$REFRESH_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "refresh: REFRESH_DATE must be YYYY-MM-DD, got: $REFRESH_DATE" >&2
  exit 2
fi

opais() { uv run --quiet --project "$OPAIS_DIR" opais "$@"; }
step() { printf '\n== %s ==\n' "$1"; }

# The raw export names people. It lives only in this folder, outside the
# repository, and the folder is deleted however the run ends.
PULL_DIR="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/opais-pull.XXXXXX")"
# The FDA's directory is public and names no person. It is kept apart all the
# same: a downloaded file is data, and it does not belong in the repository.
FDA_PULL_DIR="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fda-ndc.XXXXXX")"
trap 'rm -rf "$PULL_DIR" "$FDA_PULL_DIR"' EXIT
# The day this run fetches things. The snapshot may take the export's own day instead.
RUN_DATE="$REFRESH_DATE"

step "1. Pull the export"
EXPORT="$(OPAIS_DIR="$OPAIS_DIR" PULL_DIR="$PULL_DIR" "$HERE/pull-export.sh")"
echo "export: $(basename "$EXPORT")"
if [[ -s "$PULL_DIR/export-date" ]]; then
  EXPORT_DATE="$(cat "$PULL_DIR/export-date")"
  if [[ ! "$EXPORT_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "refresh: the export's day is not a date: $EXPORT_DATE" >&2
    exit 4
  fi
  if [[ "$EXPORT_DATE" != "$REFRESH_DATE" ]]; then
    echo "The export is dated $EXPORT_DATE; the run is on $REFRESH_DATE. Using the export's day."
    REFRESH_DATE="$EXPORT_DATE"
  fi
fi

step "2. Make the snapshot"
mkdir -p "$SNAP_DIR" "$REPORT_DIR"
PREV="$(find "$SNAP_DIR" -maxdepth 1 -name "$STATE-*.json" ! -name "$STATE-$REFRESH_DATE.json" | sort | tail -n 1)"
NEW="$SNAP_DIR/$STATE-$REFRESH_DATE.json"
opais snapshot "$EXPORT" --date "$REFRESH_DATE" --state "$STATE" --out "$NEW"

step "3. Compare with the last snapshot"
if [[ -z "$PREV" ]]; then
  echo "No earlier snapshot. This one becomes the starting point; there is nothing to compare."
else
  echo "earlier snapshot: $PREV"
  code=0
  opais changes "$PREV" "$NEW" --format md --out "$REPORT_DIR/$STATE-$REFRESH_DATE.md" || code=$?
  if [[ "$code" -eq 0 || "$code" -eq 3 ]]; then
    opais changes "$PREV" "$NEW" --format json --out "$REPORT_DIR/$STATE-$REFRESH_DATE.json" || true
  fi
  if [[ "$code" -eq 3 ]]; then
    echo "refresh: the amount of change is unusual. Stopping so a person can read the report." >&2
    exit 3
  elif [[ "$code" -ne 0 ]]; then
    echo "refresh: the comparison failed (exit $code)." >&2
    exit "$code"
  fi
fi

step "4. Bring the FDA drug names up to date"
# The names shown beside the drug codes come from the FDA's National Drug Code
# Directory. A name once listed is kept when the directory later drops it. An
# unusual amount of change stops the run before anything is written.
FDA_FILES="$(FDA_PULL_DIR="$FDA_PULL_DIR" "$HERE/pull-fda-ndc.sh")"
code=0
(cd "$SITE_DIR" && node scripts/reference/build-fda-ndc.mjs "$FDA_FILES" "$RUN_DATE" "$FDA_PULL_DIR/ndctext.zip" --report "$REPORT_DIR/fda-ndc-$RUN_DATE.md") || code=$?
if [[ "$code" -eq 3 ]]; then
  echo "refresh: the FDA drug names changed by an unusual amount. Stopping so a person can read the report." >&2
  exit 3
elif [[ "$code" -ne 0 ]]; then
  echo "refresh: the FDA drug names could not be built (exit $code)." >&2
  exit "$code"
fi

step "5. Rebuild the site and run every check"
cd "$SITE_DIR"
printf '{\n  "last_refresh": "%s",\n  "state": "%s",\n  "snapshot": "%s"\n}\n' \
  "$REFRESH_DATE" "$STATE" "$(basename "$NEW")" > "$SITE_DIR/refresh/last-refresh.json"
npm run check:data
npm run check
npm test
npm run build
npm run check:dist

if [[ "${FORCE_FAILURE:-false}" == "true" ]]; then
  step "Forced failure (drill)"
  echo "refresh: FORCE_FAILURE is on. Every check passed, and the run now fails on purpose." >&2
  exit 9
fi

step "Full pass"
echo "The site in dist/ is ready to publish."
