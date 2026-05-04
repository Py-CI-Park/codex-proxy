param(
  [string]$Branch = "master",
  [string]$UpstreamRemote = "upstream",
  [string]$OriginRemote = "origin",
  [string]$TargetRef = "",
  [switch]$Apply,
  [switch]$PushOrigin,
  [switch]$SkipInstall,
  [switch]$SkipTests,
  [switch]$SkipDirtyCheck
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Script
  )

  Write-Host ""
  Write-Host "== $Name =="
  & $Script
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

function Get-CommandOutput {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Command)
  $output = & $Command[0] $Command[1..($Command.Length - 1)] 2>$null
  return @($output)
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw "This script must be run inside a git repository."
}
Set-Location $repoRoot

$currentBranch = (& git branch --show-current).Trim()
if ($currentBranch -ne $Branch) {
  throw "Expected branch '$Branch' but current branch is '$currentBranch'."
}

$remotes = @(& git remote)
if ($remotes -notcontains $UpstreamRemote) {
  throw "Missing upstream remote '$UpstreamRemote'."
}
if ($remotes -notcontains $OriginRemote) {
  throw "Missing origin remote '$OriginRemote'."
}

$upstreamPushUrl = (& git remote get-url --push $UpstreamRemote).Trim()
if ($upstreamPushUrl -ne "DISABLED") {
  Write-Warning "Upstream push URL is '$upstreamPushUrl'. This fork expects upstream push to be disabled."
}

if (-not $SkipDirtyCheck) {
  $dirty = @(& git status --porcelain)
  if ($dirty.Count -gt 0) {
    Write-Host "Working tree has uncommitted changes:"
    $dirty | ForEach-Object { Write-Host $_ }
    throw "Commit, stash, or discard local changes before syncing upstream."
  }
}

Write-Host "Repository : $repoRoot"
Write-Host "Branch     : $currentBranch"
Write-Host "Policy     : stable-first; local-preserving"
Write-Host "Apply      : $Apply"
Write-Host "PushOrigin : $PushOrigin"

Invoke-Step "Fetch remotes" {
  Invoke-Git fetch $UpstreamRemote --tags --prune
  Invoke-Git fetch $OriginRemote --tags --prune
}

if ([string]::IsNullOrWhiteSpace($TargetRef)) {
  $TargetRef = "$UpstreamRemote/$Branch"
}

Invoke-Git rev-parse --verify $TargetRef | Out-Null

$counts = (& git rev-list --left-right --count "HEAD...$TargetRef").Trim() -split "\s+"
$ahead = [int]$counts[0]
$behind = [int]$counts[1]

Write-Host ""
Write-Host "== Sync summary =="
Write-Host "Target ref : $TargetRef"
Write-Host "Local ahead: $ahead"
Write-Host "Local behind: $behind"

$latestStableTag = (& git describe --tags --abbrev=0 $TargetRef 2>$null)
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($latestStableTag)) {
  Write-Host "Nearest target tag: $latestStableTag"
}

$prereleaseTags = @(& git tag --list "v*-beta*" --sort=-creatordate | Select-Object -First 5)
if ($prereleaseTags.Count -gt 0) {
  Write-Host "Recent prerelease tags, not used by default:"
  $prereleaseTags | ForEach-Object { Write-Host "  $_" }
}

Write-Host ""
Write-Host "== Upstream commits not in local =="
$upstreamCommits = @(& git log --oneline "HEAD..$TargetRef")
if ($upstreamCommits.Count -eq 0) {
  Write-Host "(none)"
} else {
  $upstreamCommits | ForEach-Object { Write-Host $_ }
}

Write-Host ""
Write-Host "== Local commits not in target =="
$localCommits = @(& git log --oneline "$TargetRef..HEAD")
if ($localCommits.Count -eq 0) {
  Write-Host "(none)"
} else {
  $localCommits | ForEach-Object { Write-Host $_ }
}

if (-not $Apply) {
  Write-Host ""
  Write-Host "Preview complete. Re-run with -Apply to merge $TargetRef."
  exit 0
}

Invoke-Step "Merge target" {
  Invoke-Git merge --no-edit $TargetRef
}

if (-not $SkipInstall) {
  Invoke-Step "Install root dependencies" {
    npm install
  }

  if (Test-Path (Join-Path $repoRoot "web/package.json")) {
    Invoke-Step "Install web dependencies" {
      Push-Location (Join-Path $repoRoot "web")
      try {
        npm install
      } finally {
        Pop-Location
      }
    }
  }
}

Invoke-Step "Build" {
  npm run build
}

if (-not $SkipTests) {
  Invoke-Step "Test" {
    npm test
  }
}

if ($PushOrigin) {
  Invoke-Step "Push origin" {
    Invoke-Git push $OriginRemote $Branch
  }
} else {
  Write-Host ""
  Write-Host "Verified locally. Review and push with: git push $OriginRemote $Branch"
}
