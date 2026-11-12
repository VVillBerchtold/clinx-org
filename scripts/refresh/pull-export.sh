#!/usr/bin/env bash
# Get one HRSA OPAIS "Covered Entity Daily Export" (JSON) and print its path.
#
# HRSA has no plain download address for the export. Its public reports page
# hands the file over when the button is pressed, so the OPAIS library's
# `opais pull` opens that one page in a plain headless browser and presses that
# one button once. It makes one attempt and refuses anything that is not the
# expected file.
#
#   OPAIS_DIR=/path/to/opais  PULL_DIR=/tmp/somewhere  ./pull-export.sh
#
# A person can also supply a file, and then nothing is fetched:
#
#   OPAIS_EXPORT_FILE=/path/to/export.json  ./pull-export.sh
#
# The raw export names people. It is saved only inside PULL_DIR, which the
# caller creates outside the repository and deletes when it is done. Nothing
# from inside the file is printed. Beside the export this script leaves a file
# named `export-date` holding the day in the export's own file name.
#
# Exit 4 means "no export": the refresh stops and nothing is published.
set -euo pipefail

MEMBER="OPA_CE_DAILY_PUBLIC.JSON"

if [[ -n "${OPAIS_EXPORT_FILE:-}" ]]; then
  if [[ ! -s "$OPAIS_EXPORT_FILE" ]]; then
    echo "pull: OPAIS_EXPORT_FILE is set but the file is missing or empty: $OPAIS_EXPORT_FILE" >&2
    exit 4
  fi
  printf '%s\n' "$OPAIS_EXPORT_FILE"
  exit 0
fi

if [[ -z "${OPAIS_DIR:-}" || -z "${PULL_DIR:-}" ]]; then
  echo "pull: set OPAIS_DIR (the OPAIS library) and PULL_DIR (an empty folder outside the repository)." >&2
  exit 4
fi
if [[ ! -d "$PULL_DIR" ]]; then
  echo "pull: PULL_DIR is not a folder: $PULL_DIR" >&2
  exit 4
fi

code=0
summary="$(uv run --quiet --project "$OPAIS_DIR" --extra pull opais pull --out "$PULL_DIR" --timeout "${PULL_TIMEOUT:-300}")" || code=$?
if [[ "$code" -ne 0 ]]; then
  echo "pull: HRSA's export could not be fetched (opais pull exit $code)." >&2
  exit 4
fi

# The summary is one line about the file: its name, size, hash and dates.
echo "pull: $summary" >&2
name="$(printf '%s' "$summary" | sed -n 's/.*"file": "\([A-Za-z0-9._-]*\)".*/\1/p')"
day="$(printf '%s' "$summary" | sed -n 's/.*"export_date": "\([0-9-]*\)".*/\1/p')"
if [[ -z "$name" || ! -s "$PULL_DIR/$name" ]]; then
  echo "pull: the fetch reported no file." >&2
  exit 4
fi
if [[ ! "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "pull: the export's file name carries no date, so its day is unknown." >&2
  exit 4
fi

if ! unzip -q -o "$PULL_DIR/$name" "$MEMBER" -d "$PULL_DIR"; then
  echo "pull: the export could not be unpacked." >&2
  exit 4
fi
rm -f "$PULL_DIR/$name"
printf '%s\n' "$day" > "$PULL_DIR/export-date"
printf '%s\n' "$PULL_DIR/$MEMBER"
