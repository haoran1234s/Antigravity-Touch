[CmdletBinding()]
param(
  [string]$AllowedEmail,
  [string]$NgrokAuthtoken,
  [string]$NgrokDomain,
  [int]$Port = 0,
  [int]$CdpPort = 0,
  [string]$ProjectDir,
  [string]$AntigravityBinary,
  [switch]$NoTunnel,
  [switch]$SkipAntigravity,
  [switch]$RestartAntigravity,
  [switch]$NoInstall,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Info([string]$Message) {
  Write-Host "    $Message" -ForegroundColor DarkGray
}

function Write-Warn([string]$Message) {
  Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Test-Placeholder([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
  $trimmed = $Value.Trim()
  return $trimmed -in @('put-your-ngrok-authtoken-here', 'you@gmail.com')
}

function Unquote-DotEnvValue([string]$Value) {
  if ($null -eq $Value) { return '' }
  $v = $Value.Trim()
  if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
    $v = $v.Substring(1, $v.Length - 2)
  }
  return ($v -replace '\\"', '"')
}

function Read-DotEnv([string]$Path) {
  $vars = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $vars }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $vars[$Matches[1]] = Unquote-DotEnvValue $Matches[2]
    }
  }
  return $vars
}

function Format-DotEnvValue([string]$Value) {
  if ($null -eq $Value) { return '' }
  $v = $Value -replace "[`r`n]+", ' '
  if ($v -match '^\s|\s$|#|"') {
    return '"' + ($v -replace '"', '\"') + '"'
  }
  return $v
}

function Save-DotEnvValues([string]$Path, [hashtable]$Updates) {
  if ($Updates.Count -eq 0) { return }

  $lines = New-Object System.Collections.Generic.List[string]
  if (Test-Path -LiteralPath $Path) {
    foreach ($line in Get-Content -LiteralPath $Path) {
      $lines.Add($line)
    }
  }

  foreach ($key in $Updates.Keys) {
    $valueLine = "$key=$(Format-DotEnvValue ([string]$Updates[$key]))"
    $pattern = '^\s*' + [regex]::Escape($key) + '\s*='
    $updated = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match $pattern) {
        $lines[$i] = $valueLine
        $updated = $true
        break
      }
    }

    if (-not $updated) {
      if ($lines.Count -gt 0 -and $lines[$lines.Count - 1].Trim() -ne '') {
        $lines.Add('')
      }
      $lines.Add($valueLine)
    }
  }

  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    if ($ptr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
  }
}

function Get-Setting([string]$ParamValue, [string]$EnvValue, [hashtable]$FileVars, [string]$Key, [string]$Default = '') {
  foreach ($candidate in @($ParamValue, $EnvValue, $FileVars[$Key], $Default)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$candidate) -and -not (Test-Placeholder ([string]$candidate))) {
      return [string]$candidate
    }
  }
  return ''
}

function Resolve-RepoPath([string]$Base, [string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return '' }
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $Base $PathValue))
}

function Find-AntigravityBinary([string]$Override) {
  $candidates = New-Object System.Collections.Generic.List[string]

  if (-not [string]::IsNullOrWhiteSpace($Override)) { $candidates.Add($Override) }
  if (-not [string]::IsNullOrWhiteSpace($env:ANTIGRAVITY_BINARY)) { $candidates.Add($env:ANTIGRAVITY_BINARY) }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'))
    $candidates.Add((Join-Path $env:LOCALAPPDATA 'antigravity\Antigravity.exe'))
  }
  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
    $candidates.Add((Join-Path $env:ProgramFiles 'Antigravity\Antigravity.exe'))
  }
  if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
    $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'Antigravity\Antigravity.exe'))
  }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return ''
}

function Test-Cdp([int]$PortNumber) {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$PortNumber/json/version" -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Get-Masked([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '<empty>' }
  if ($Value.Length -le 12) { return '********' }
  return ($Value.Substring(0, 6) + '...' + $Value.Substring($Value.Length - 4))
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..'))
$envPath = Join-Path $repoRoot '.env.local'
$examplePath = Join-Path $repoRoot '.env.example'

Set-Location $repoRoot

Write-Step "Prepare Antigravity Touch"
Write-Info "Repo: $repoRoot"

if (-not (Test-Path -LiteralPath $envPath) -and (Test-Path -LiteralPath $examplePath)) {
  if ($DryRun) {
    Write-Info "Would create .env.local from .env.example"
  } else {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
    Write-Info "Created .env.local from .env.example"
  }
}

if (Test-Path -LiteralPath $envPath) {
  $fileVars = Read-DotEnv $envPath
} elseif (Test-Path -LiteralPath $examplePath) {
  $fileVars = Read-DotEnv $examplePath
} else {
  $fileVars = @{}
}

$AllowedEmail = Get-Setting $AllowedEmail $env:ALLOWED_EMAIL $fileVars 'ALLOWED_EMAIL'
$NgrokAuthtoken = Get-Setting $NgrokAuthtoken $env:NGROK_AUTHTOKEN $fileVars 'NGROK_AUTHTOKEN'
$NgrokDomain = Get-Setting $NgrokDomain $env:NGROK_DOMAIN $fileVars 'NGROK_DOMAIN'

$rawPort = if ($PSBoundParameters.ContainsKey('Port') -and $Port -gt 0) { [string]$Port } elseif ($env:PORT) { $env:PORT } elseif ($fileVars['PORT']) { $fileVars['PORT'] } else { '5555' }
$rawCdpPort = if ($PSBoundParameters.ContainsKey('CdpPort') -and $CdpPort -gt 0) { [string]$CdpPort } elseif ($env:CDP_PORT) { $env:CDP_PORT } elseif ($fileVars['CDP_PORT']) { $fileVars['CDP_PORT'] } else { '9223' }
$Port = [int]$rawPort
$CdpPort = [int]$rawCdpPort

$ProjectDir = Get-Setting $ProjectDir $env:ANTIGRAVITY_PROJECT_DIR $fileVars 'ANTIGRAVITY_PROJECT_DIR' $repoRoot
$ProjectDir = Resolve-RepoPath $repoRoot $ProjectDir
if (-not (Test-Path -LiteralPath $ProjectDir -PathType Container)) {
  Write-Warn "Project dir does not exist: $ProjectDir; fallback to repo root."
  $ProjectDir = $repoRoot
}

$AntigravityBinary = Get-Setting $AntigravityBinary $env:ANTIGRAVITY_BINARY $fileVars 'ANTIGRAVITY_BINARY'

if (-not $NoTunnel -and -not $DryRun) {
  if (Test-Placeholder $AllowedEmail) {
    $AllowedEmail = Read-Host 'Allowed Google email'
  }
  if (Test-Placeholder $NgrokAuthtoken) {
    $NgrokAuthtoken = Read-SecretText 'ngrok authtoken'
  }
}

if (-not $NoTunnel) {
  if (Test-Placeholder $AllowedEmail) {
    throw 'Missing ALLOWED_EMAIL. Fill .env.local or run: .\start-remote.cmd -AllowedEmail you@gmail.com -NgrokAuthtoken <token>'
  }
  if (Test-Placeholder $NgrokAuthtoken) {
    throw 'Missing NGROK_AUTHTOKEN. Fill .env.local or run: .\start-remote.cmd -AllowedEmail you@gmail.com -NgrokAuthtoken <token>'
  }
}

$updates = @{}
if (-not (Test-Placeholder $AllowedEmail)) { $updates['ALLOWED_EMAIL'] = $AllowedEmail }
if (-not (Test-Placeholder $NgrokAuthtoken)) { $updates['NGROK_AUTHTOKEN'] = $NgrokAuthtoken }
if (-not [string]::IsNullOrWhiteSpace($NgrokDomain)) { $updates['NGROK_DOMAIN'] = $NgrokDomain }
$updates['PORT'] = [string]$Port
$updates['CDP_PORT'] = [string]$CdpPort
$updates['ANTIGRAVITY_PROJECT_DIR'] = $ProjectDir
if (-not [string]::IsNullOrWhiteSpace($AntigravityBinary)) { $updates['ANTIGRAVITY_BINARY'] = $AntigravityBinary }
if (-not $DryRun) { Save-DotEnvValues $envPath $updates }

if ($NoTunnel) {
  Write-Info "Mode: LAN only / no ngrok"
} else {
  Write-Info "Mode: public ngrok + Google OAuth"
}
Write-Info "Proxy port: $Port"
Write-Info "CDP port: $CdpPort"
Write-Info "Project dir: $ProjectDir"
if (-not $NoTunnel) {
  Write-Info "Allowed email: $AllowedEmail"
  if (-not [string]::IsNullOrWhiteSpace($NgrokDomain)) { Write-Info "Reserved domain: $NgrokDomain" }
  if ($DryRun) { Write-Info "ngrok token: $(Get-Masked $NgrokAuthtoken)" }
}

Write-Step "Check Node.js and dependencies"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'node was not found. Install Node.js 18+ first: https://nodejs.org/' }
Write-Info "Node: $($nodeCmd.Source)"

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules') -PathType Container)) {
  if ($NoInstall) {
    Write-Warn 'node_modules is missing, but -NoInstall was set. If startup fails, run npm install.'
  } else {
    Write-Info 'node_modules is missing; running npm install...'
    if ($DryRun) {
      Write-Host "DRY-RUN: npm install"
    } else {
      npm install
    }
  }
}

if (-not $SkipAntigravity) {
  Write-Step "Check / start Antigravity"
  if (Test-Cdp $CdpPort) {
    Write-Info "CDP is available: http://127.0.0.1:$CdpPort/json/version"
  } else {
    $binary = Find-AntigravityBinary $AntigravityBinary
    if ([string]::IsNullOrWhiteSpace($binary)) {
      Write-Warn 'Could not find Antigravity.exe. Start Antigravity manually with --remote-debugging-port=9223, or set ANTIGRAVITY_BINARY in .env.local.'
    } else {
      $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*Antigravity*' })
      if ($running.Count -gt 0) {
        if ($RestartAntigravity) {
          Write-Warn 'Antigravity is running but CDP is unavailable; restarting because -RestartAntigravity was set.'
          if (-not $DryRun) { $running | Stop-Process -Force }
        } else {
          $answer = if ($DryRun) { 'n' } else { Read-Host 'Antigravity is running but CDP is unavailable. Restart it now? [y/N]' }
          if ($answer -match '^(y|yes)$') {
            $running | Stop-Process -Force
          } else {
            Write-Warn 'Skipped restart. If IDE connection fails, close Antigravity and rerun this script, or add -RestartAntigravity.'
          }
        }
      }

      if (-not (Test-Cdp $CdpPort)) {
        $argList = @("--remote-debugging-port=$CdpPort", '--new-window', "`"$ProjectDir`"")
        Write-Info "Starting: $binary $($argList -join ' ')"
        if ($DryRun) {
          Write-Host "DRY-RUN: Start-Process -FilePath `"$binary`" -ArgumentList $($argList -join ' ') -WorkingDirectory `"$ProjectDir`""
        } else {
          Start-Process -FilePath $binary -ArgumentList $argList -WorkingDirectory $ProjectDir
          for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 750
            if (Test-Cdp $CdpPort) {
              Write-Info "CDP is ready."
              break
            }
          }
          if (-not (Test-Cdp $CdpPort)) {
            Write-Warn "Antigravity started, but CDP is not responding yet; the CLI will keep trying."
          }
        }
      }
    }
  }
}

Write-Step "Start proxy"
$env:PORT = [string]$Port
$env:CDP_PORT = [string]$CdpPort
$env:ANTIGRAVITY_PROJECT_DIR = $ProjectDir
if (-not [string]::IsNullOrWhiteSpace($AntigravityBinary)) { $env:ANTIGRAVITY_BINARY = $AntigravityBinary }

$cliArgs = @((Join-Path $repoRoot 'bin\cli.js'))
if ($NoTunnel) {
  $cliArgs += @('--no-tunnel', '--port', [string]$Port, '--host', '0.0.0.0')
} else {
  $env:ALLOWED_EMAIL = $AllowedEmail
  $env:NGROK_AUTHTOKEN = $NgrokAuthtoken
  if (-not [string]::IsNullOrWhiteSpace($NgrokDomain)) { $env:NGROK_DOMAIN = $NgrokDomain }
  $cliArgs += @('--non-interactive', '--email', $AllowedEmail, '--port', [string]$Port, '--authtoken', $NgrokAuthtoken)
  if (-not [string]::IsNullOrWhiteSpace($NgrokDomain)) { $cliArgs += @('--domain', $NgrokDomain) }
}

if ($DryRun) {
  $displayArgs = @()
  for ($i = 0; $i -lt $cliArgs.Count; $i++) {
    if ($cliArgs[$i] -eq '--authtoken' -and ($i + 1) -lt $cliArgs.Count) {
      $displayArgs += '--authtoken'
      $displayArgs += (Get-Masked $cliArgs[$i + 1])
      $i++
    } else {
      $displayArgs += $cliArgs[$i]
    }
  }
  Write-Host "DRY-RUN: node $($displayArgs -join ' ')"
  Write-Host ""
  Write-Host "Dry run complete. No Antigravity, ngrok, or proxy process was started."
} else {
  & node @cliArgs
}

