# Docs: docs/code/scripts/sandbox.md
# Starts the clean-setup scenario P1 (A43, J0) in Windows Sandbox: a fresh Windows that is thrown
# away when it closes. It writes the sandbox's configuration for this checkout and starts it; the
# sandbox then runs p1-prepare.ps1, which downloads Tessera at the commit given and installs Node
# and Tessera, but never Claude Code or Codex: finding those is what the setup check is tested on.
# Nothing here touches this machine's Tessera data. Windows PowerShell 5.1.
param(
  # The commit of github.com/suredo/Tessera to install: by default, origin/main as this checkout
  # last fetched it.
  [string]$Commit = "",
  # The hard cap on model calls the owner approved for the run (ENG-07); Tessera in the sandbox
  # refuses any call past it.
  [Parameter(Mandatory = $true)][int]$CallCap
)
$ErrorActionPreference = "Stop"

$sandbox = Join-Path $env:WINDIR "System32\WindowsSandbox.exe"
if (-not (Test-Path $sandbox)) {
  Write-Host "Windows Sandbox isn't turned on. In PowerShell run as administrator:"
  Write-Host "  Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All"
  Write-Host "then restart Windows and run this again."
  exit 1
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if ($Commit -eq "") { $Commit = (git -C $root rev-parse origin/main).Trim() }
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "The commit must be a full 40-character hash: $Commit" }
if ($CallCap -lt 1) { throw "The call cap must be at least 1, not $CallCap." }

# The folder the sandbox sees, read-only: the preparation script and the commit to install.
$run = Join-Path $root "test-output\p1"
New-Item -ItemType Directory -Force $run | Out-Null
Copy-Item (Join-Path $PSScriptRoot "p1-prepare.ps1") $run -Force
Set-Content -Path (Join-Path $run "commit.txt") -Value $Commit -Encoding ascii
Set-Content -Path (Join-Path $run "callcap.txt") -Value $CallCap -Encoding ascii

$inside = "C:\Users\WDAGUtilityAccount\Desktop\p1"
$config = @"
<Configuration>
  <Networking>Enable</Networking>
  <MemoryInMB>4096</MemoryInMB>
  <ClipboardRedirection>Enable</ClipboardRedirection>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$run</HostFolder>
      <SandboxFolder>$inside</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoExit -ExecutionPolicy Bypass -File $inside\p1-prepare.ps1</Command>
  </LogonCommand>
</Configuration>
"@
$wsb = Join-Path $run "p1.wsb"
Set-Content -Path $wsb -Value $config -Encoding utf8
Write-Host "Starting Windows Sandbox for P1 at $Commit, with at most $CallCap model calls."
Start-Process $wsb
