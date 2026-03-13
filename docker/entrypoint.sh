#!/usr/bin/env bash
set -euo pipefail

cd /workspace

mkdir -p /workspace/.docker

# Cross-container bootstrap lock so worker/dashboard startup does not race npm installs.
LOCK_DIR="/workspace/.docker/bootstrap.lock"
LOCK_PID_FILE="${LOCK_DIR}/pid"

release_lock() {
  rm -rf "${LOCK_DIR}" 2>/dev/null || true
}

while true; do
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    printf "%s" "$$" > "${LOCK_PID_FILE}"
    break
  fi

  # Recover stale lock if owner process is gone.
  if [[ -f "${LOCK_PID_FILE}" ]]; then
    LOCK_PID="$(cat "${LOCK_PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${LOCK_PID}" ]] && ! kill -0 "${LOCK_PID}" 2>/dev/null; then
      rm -rf "${LOCK_DIR}" 2>/dev/null || true
      continue
    fi
  fi

  sleep 0.2
done
trap release_lock EXIT INT TERM

# Keep Linux-native dependencies inside container volume and reinstall only when lockfile changes.
LOCK_HASH_FILE="/workspace/.docker/.package-lock.sha256"
CURRENT_LOCK_HASH="$(sha256sum package-lock.json | awk '{print $1}')"
SAVED_LOCK_HASH=""

if [[ -f "${LOCK_HASH_FILE}" ]]; then
  SAVED_LOCK_HASH="$(cat "${LOCK_HASH_FILE}")"
fi

if [[ ! -d /workspace/node_modules ]] || [[ "${CURRENT_LOCK_HASH}" != "${SAVED_LOCK_HASH}" ]]; then
  npm ci
  printf "%s" "${CURRENT_LOCK_HASH}" > "${LOCK_HASH_FILE}"
fi

if [[ "${CODEX_MEM_BUILD_ON_START:-1}" == "1" ]]; then
  NEEDS_BUILD=0

  if [[ ! -f /workspace/dist/cli.js ]]; then
    NEEDS_BUILD=1
  elif [[ "${CODEX_MEM_FORCE_BUILD:-0}" == "1" ]]; then
    NEEDS_BUILD=1
  elif [[ package.json -nt dist/cli.js ]] || [[ package-lock.json -nt dist/cli.js ]] || [[ tsconfig.build.json -nt dist/cli.js ]]; then
    NEEDS_BUILD=1
  elif [[ -n "$(find src -type f -newer dist/cli.js -print -quit 2>/dev/null)" ]]; then
    NEEDS_BUILD=1
  fi

  if [[ "${NEEDS_BUILD}" == "1" ]]; then
    npm run build
  fi
fi

release_lock
trap - EXIT INT TERM

exec "$@"
