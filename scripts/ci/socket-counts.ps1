# Docs: docs/code/ci/workflow.md
# Counts the machine's TCP connections by state every 10 seconds while the browser tests run on
# CI, so a run that fails with net::ERR_NO_BUFFER_SPACE shows whether the machine ran out of
# ephemeral ports, and when (#216, ENG-20). It only reads: Get-NetTCPConnection and netsh.
#   socket-counts.ps1 -Watch    samples until the stop file appears, into test-output/sockets
#   socket-counts.ps1 -Report   stops the sampling and prints the peaks and the port range
param([switch]$Watch, [switch]$Report)

$folder = Join-Path (Get-Location) "test-output/sockets"
$samples = Join-Path $folder "samples.csv"
$stop = Join-Path $folder "stop"

if ($Watch) {
  New-Item -ItemType Directory -Force $folder | Out-Null
  Remove-Item $stop -ErrorAction SilentlyContinue
  "time,total,established,time_wait,close_wait,fin_wait_2,listen" | Set-Content -Encoding utf8 $samples
  while (-not (Test-Path $stop)) {
    $all = @(Get-NetTCPConnection -ErrorAction SilentlyContinue)
    $count = { param($state) @($all | Where-Object { "$($_.State)" -eq $state }).Count }
    $line = @(
      (Get-Date).ToString("o"),
      $all.Count,
      (& $count "Established"),
      (& $count "TimeWait"),
      (& $count "CloseWait"),
      (& $count "FinWait2"),
      (& $count "Listen")
    ) -join ","
    Add-Content -Encoding utf8 $samples $line
    Start-Sleep -Seconds 10
  }
  exit 0
}

if ($Report) {
  New-Item -ItemType File -Force $stop | Out-Null
  if (-not (Test-Path $samples)) {
    Write-Output "No socket counts were taken."
    exit 0
  }
  $rows = @(Import-Csv $samples)
  Write-Output "Socket counts, $($rows.Count) samples, 10 seconds apart (#216):"
  foreach ($column in "total", "established", "time_wait", "close_wait", "fin_wait_2", "listen") {
    $peak = ($rows | ForEach-Object { [int]$_.$column } | Measure-Object -Maximum).Maximum
    Write-Output ("  {0,-12} peak {1}" -f $column, $peak)
  }
  Write-Output "The ephemeral port range:"
  netsh int ipv4 show dynamicport tcp
  exit 0
}

Write-Output "Give -Watch or -Report."
exit 1
