#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ -z "${DOLTHUB_API_TOKEN:-}" ]]; then
  if ! command -v vw-unlock >/dev/null 2>&1; then
    printf 'vw-unlock is required to load DOLTHUB_API_TOKEN from Vaultwarden.\n' >&2
    exit 1
  fi

  if ! command -v bw >/dev/null 2>&1; then
    printf 'bw is required to read the DoltHub API Token from Vaultwarden.\n' >&2
    exit 1
  fi

  BW_SESSION="$(vw-unlock)"
  export BW_SESSION
  DOLTHUB_API_TOKEN="$(bw get password 'DoltHub API Token')"
  export DOLTHUB_API_TOKEN
fi

exec docker compose "$@"
