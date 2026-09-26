#!/usr/bin/env bash
# Run docker compose against docker-compose.dev.yml with build provenance and a
# guard that keeps git worktrees from replacing the shared local stack.
#
#   tools/dev-compose.sh up -d --build frontend
#   tools/dev-compose.sh ps
#
# - Stamps images with the commit, dirty flag, checkout path and build time
#   (docker inspect ffi_hr_frontend, or http://localhost:5173/build-info.json).
# - From a git worktree, commands that change containers or images are refused
#   while they would hit the shared stack (default project/prefix). Use a
#   separate stack instead, e.g.:
#     FFI_CONTAINER_PREFIX=ffi_wt1 FFI_FRONTEND_PORT=5273 FFI_BACKEND_PORT=8100 \
#     FFI_DB_PORT=5532 EVOLUTION_API_PORT=8180 tools/dev-compose.sh -p hr-ffi-wt1 up -d --build
#   Set FFI_ALLOW_SHARED_STACK=1 only when the user explicitly asked for it.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
compose_file="$root/docker-compose.dev.yml"

git_dir="$(cd "$root" && git rev-parse --absolute-git-dir)"
common_dir="$(cd "$root" && cd "$(git rev-parse --git-common-dir)" && pwd -P)"
is_worktree=0
[ "$(cd "$git_dir" && pwd -P)" != "$common_dir" ] && is_worktree=1

# Resolve the compose project the same way docker compose does (flag, env, dir).
# Global flags come before the subcommand; some of them take a value.
project="${COMPOSE_PROJECT_NAME:-}"
subcommand=""
value_for=""
for arg in "$@"; do
  if [ -n "$value_for" ]; then
    [ "$value_for" = project ] && project="$arg"
    value_for=""
    continue
  fi
  case "$arg" in
    -p | --project-name) value_for=project ;;
    --profile | --env-file | --project-directory | -f | --file | --ansi | --progress | --parallel) value_for=other ;;
    --project-name=*) project="${arg#--project-name=}" ;;
    -*) ;;
    *) subcommand="$arg"; break ;;
  esac
done
if [ -z "$project" ]; then
  project="$(basename "$root" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
fi

prefix="${FFI_CONTAINER_PREFIX:-ffi_hr}"
shared=0
if [ "$project" = "hr-ffi-system" ] || [ "$prefix" = "ffi_hr" ]; then
  shared=1
fi

case "$subcommand" in
  up | build | create | run | start | restart | stop | down | rm | kill | pull | pause | unpause)
    mutating=1 ;;
  *) mutating=0 ;;
esac

if [ "$is_worktree" = 1 ] && [ "$shared" = 1 ] && [ "$mutating" = 1 ] && [ "${FFI_ALLOW_SHARED_STACK:-0}" != 1 ]; then
  cat >&2 <<EOF
Refusing to run 'docker compose $subcommand' against the shared local stack from a worktree:
  checkout: $root
  project:  $project   container prefix: $prefix
The shared stack (localhost:5173) must only be rebuilt from the main checkout.
Run a separate stack with its own FFI_CONTAINER_PREFIX, ports and -p project
(see the header of this script), or ask the user before setting
FFI_ALLOW_SHARED_STACK=1.
EOF
  exit 2
fi

FFI_BUILD_COMMIT="$(cd "$root" && git rev-parse --short=12 HEAD)"
if [ -n "$(cd "$root" && git status --porcelain --untracked-files=no)" ]; then
  FFI_BUILD_DIRTY=true
else
  FFI_BUILD_DIRTY=false
fi
FFI_BUILD_SOURCE="$root"
FFI_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export FFI_BUILD_COMMIT FFI_BUILD_DIRTY FFI_BUILD_SOURCE FFI_BUILD_TIME

if [ "$mutating" = 1 ]; then
  echo "dev-compose: project=$project prefix=$prefix commit=$FFI_BUILD_COMMIT dirty=$FFI_BUILD_DIRTY" >&2
fi

exec docker compose -f "$compose_file" "$@"
