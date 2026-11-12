#!/usr/bin/env bash
# Get the FDA's National Drug Code Directory and print the folder that holds
# its two files, product.txt and package.txt.
#
# The directory is one public zip at a fixed address. This script downloads it
# once, over https only, checks that it holds those two files and nothing
# else, and unpacks them into a new folder. The files are data: nothing in them
# is run.
#
#   FDA_PULL_DIR=/tmp/somewhere  ./pull-fda-ndc.sh
#
# FDA_PULL_DIR is an empty folder outside the repository that the caller makes
# and deletes. The zip is left in it as ndctext.zip, so its hash can be kept.
#
# A person can also supply a folder that already holds the two files, and then
# nothing is fetched:
#
#   FDA_NDC_DIR=/path/to/folder  ./pull-fda-ndc.sh
#
# Exit 5 means "no directory": the refresh stops and nothing is published.
set -euo pipefail

URL="https://www.accessdata.fda.gov/cder/ndctext.zip"
MAX_ZIP=$((100 * 1024 * 1024))       # the zip is about 11 MB
MAX_UNPACKED=$((600 * 1024 * 1024))  # the two files are about 70 MB together

if [[ -n "${FDA_NDC_DIR:-}" ]]; then
  if [[ ! -s "$FDA_NDC_DIR/product.txt" || ! -s "$FDA_NDC_DIR/package.txt" ]]; then
    echo "pull-fda: FDA_NDC_DIR is set but product.txt or package.txt is missing or empty: $FDA_NDC_DIR" >&2
    exit 5
  fi
  printf '%s\n' "$FDA_NDC_DIR"
  exit 0
fi

if [[ -z "${FDA_PULL_DIR:-}" || ! -d "${FDA_PULL_DIR:-}" ]]; then
  echo "pull-fda: set FDA_PULL_DIR to an empty folder outside the repository." >&2
  exit 5
fi

zip="$FDA_PULL_DIR/ndctext.zip"
files="$FDA_PULL_DIR/files"
if [[ -e "$zip" || -e "$files" ]]; then
  echo "pull-fda: FDA_PULL_DIR already holds a download. Give it an empty folder." >&2
  exit 5
fi

if ! curl --fail --silent --show-error --location \
  --proto '=https' --proto-redir '=https' \
  --max-time 300 --max-filesize "$MAX_ZIP" --retry 2 --retry-delay 10 \
  --output "$zip" "$URL"; then
  echo "pull-fda: the FDA's directory could not be downloaded." >&2
  exit 5
fi

size="$(wc -c < "$zip" | tr -d ' ')"
if (( size < 1024 * 1024 || size > MAX_ZIP )); then
  echo "pull-fda: the download is $size bytes, which is not the size of the directory." >&2
  exit 5
fi

# The zip must hold exactly the two files, by name, and nothing else.
if ! listing="$(unzip -Z1 "$zip" 2>/dev/null | sort | tr '\n' ' ')"; then
  echo "pull-fda: the download is not a zip." >&2
  exit 5
fi
if [[ "$listing" != "package.txt product.txt " ]]; then
  echo "pull-fda: the zip does not hold exactly package.txt and product.txt." >&2
  exit 5
fi
unpacked="$(unzip -l "$zip" | tail -n 1 | awk '{print $1}')"
if [[ ! "$unpacked" =~ ^[0-9]+$ ]] || (( unpacked > MAX_UNPACKED )); then
  echo "pull-fda: the zip would unpack to an unexpected size." >&2
  exit 5
fi

mkdir "$files"
if ! unzip -q "$zip" product.txt package.txt -d "$files"; then
  echo "pull-fda: the zip could not be unpacked." >&2
  exit 5
fi
echo "pull-fda: ndctext.zip, $size bytes, sha256 $( (sha256sum "$zip" 2>/dev/null || shasum -a 256 "$zip") | awk '{print $1}')" >&2
printf '%s\n' "$files"
