# Run docker compose against docker-compose.dev.yml with build provenance and a
# guard that keeps git worktrees from replacing the shared local stack.
# PowerShell twin of tools/dev-compose.sh; see that file for details.
#
#   .\tools\dev-compose.ps1 up -d --build frontend
#   .\tools\dev-compose.ps1 ps
#
# From a worktree, use a separate stack:
#   $env:FFI_CONTAINER_PREFIX='ffi_wt1'; $env:FFI_FRONTEND_PORT='5273'
#   $env:FFI_BACKEND_PORT='8100'; $env:FFI_DB_PORT='5532'; $env:EVOLUTION_API_PORT='8180'
#   .\tools\dev-compose.ps1 -p hr-ffi-wt1 up -d --build
# Set $env:FFI_ALLOW_SHARED_STACK='1' only when the user explicitly asked for it.
$ErrorActionPreference = 'Stop'

$root = (git rev-parse --show-toplevel).Trim()
$composeFile = Join-Path $root 'docker-compose.dev.yml'

Push-Location $root
try {
    $gitDir = (Resolve-Path (git rev-parse --absolute-git-dir).Trim()).Path
    $commonDir = (Resolve-Path (git rev-parse --git-common-dir).Trim()).Path
    $commit = (git rev-parse --short=12 HEAD).Trim()
    $dirty = if (git status --porcelain --untracked-files=no) { 'true' } else { 'false' }
}
finally {
    Pop-Location
}
$isWorktree = $gitDir.TrimEnd('\', '/') -ne $commonDir.TrimEnd('\', '/')

# Global flags come before the subcommand; some of them take a value.
$project = $env:COMPOSE_PROJECT_NAME
$subcommand = ''
$valueFor = ''
foreach ($arg in $args) {
    if ($valueFor) {
        if ($valueFor -eq 'project') { $project = $arg }
        $valueFor = ''
        continue
    }
    if ($arg -in @('-p', '--project-name')) { $valueFor = 'project' }
    elseif ($arg -in @('--profile', '--env-file', '--project-directory', '-f', '--file', '--ansi', '--progress', '--parallel')) { $valueFor = 'other' }
    elseif ($arg -like '--project-name=*') { $project = $arg.Substring(15) }
    elseif ($arg -like '-*') { }
    else { $subcommand = $arg; break }
}
if (-not $project) {
    $project = ((Split-Path $root -Leaf).ToLower() -replace '[^a-z0-9_-]', '')
}

$prefix = if ($env:FFI_CONTAINER_PREFIX) { $env:FFI_CONTAINER_PREFIX } else { 'ffi_hr' }
$shared = ($project -eq 'hr-ffi-system') -or ($prefix -eq 'ffi_hr')
$mutating = $subcommand -in @('up', 'build', 'create', 'run', 'start', 'restart', 'stop', 'down', 'rm', 'kill', 'pull', 'pause', 'unpause')

if ($isWorktree -and $shared -and $mutating -and $env:FFI_ALLOW_SHARED_STACK -ne '1') {
    [Console]::Error.WriteLine(@"
Refusing to run 'docker compose $subcommand' against the shared local stack from a worktree:
  checkout: $root
  project:  $project   container prefix: $prefix
The shared stack (localhost:5173) must only be rebuilt from the main checkout.
Run a separate stack with its own FFI_CONTAINER_PREFIX, ports and -p project
(see the header of this script), or ask the user before setting
FFI_ALLOW_SHARED_STACK=1.
"@)
    exit 2
}

$env:FFI_BUILD_COMMIT = $commit
$env:FFI_BUILD_DIRTY = $dirty
$env:FFI_BUILD_SOURCE = $root
$env:FFI_BUILD_TIME = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

if ($mutating) {
    [Console]::Error.WriteLine("dev-compose: project=$project prefix=$prefix commit=$commit dirty=$dirty")
}

docker compose -f $composeFile @args
exit $LASTEXITCODE
