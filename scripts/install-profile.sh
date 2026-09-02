#!/bin/bash
# install-profile.sh — write a .pro/.me install profile for the UNIFIED bare-ai CLI.
# Profiles only set defaults the binary already honours via env (BARE_AI_ENDPOINT,
# BARE_AI_MODEL, optional key). ONE binary; switching profile = switching defaults.
# Usage: install-profile.sh <pro|me> [--model <id>] [--key <value>]
set -euo pipefail

PROFILE_DIR="${BARE_AI_HOME:-$HOME/.bare-ai}"
PROFILE_FILE="$PROFILE_DIR/profile.env"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <pro|me> [--model <model_id>] [--key <key>]" >&2
  exit 1
fi

MODE="$1"; shift
MODEL=""
KEY=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --key)   KEY="$2";   shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$PROFILE_DIR"

case "$MODE" in
  pro)
    ENDPOINT="https://api.anthropic.com/v1/messages"
    [ -z "$MODEL" ] && MODEL="claude-sonnet-4-6"
    ;;
  me)
    ENDPOINT="https://api.bare-ai.net"
    [ -z "$MODEL" ] && MODEL=""
    ;;
  *)
    echo "profile must be 'pro' or 'me'" >&2; exit 1
    ;;
esac

TMP="$PROFILE_FILE.tmp"
{
  echo "# bare-ai profile: $MODE (written by install-profile.sh)"
  echo "export BARE_AI_PROFILE=$MODE"
  echo "export BARE_AI_ENDPOINT=$ENDPOINT"
  if [ -n "$MODEL" ]; then echo "export BARE_AI_MODEL=$MODEL"; fi
  if [ -n "$KEY" ]; then
    chmod 600 "$TMP" 2>/dev/null || true
    echo "export BARE_AI_API_KEY=$KEY"
  fi
} > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$PROFILE_FILE"

echo "profile written: $PROFILE_FILE ($MODE -> $ENDPOINT)"
echo "source it in your shell rc:  source $PROFILE_FILE"
