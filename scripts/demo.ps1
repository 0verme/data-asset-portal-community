[CmdletBinding()]
param(
    [switch]$InitOnly,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$venvPython = Join-Path $rootDir "backend\.venv\Scripts\python.exe"

function Test-PythonExecutable([string]$Candidate) {
    if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { return $false }
    & $Candidate --version *> $null
    return $LASTEXITCODE -eq 0
}

if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
    $pythonCommand = $venvPython
} else {
    $pythonCommand = $null
    foreach ($commandName in @("python", "python3")) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($command -and (Test-PythonExecutable $command.Source)) {
            $pythonCommand = $command.Source
            break
        }
    }
    if (-not $pythonCommand) {
        $conda = Get-Command conda -ErrorAction SilentlyContinue
        if ($conda) {
            $previousErrorActionPreference = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $condaRoot = (& $conda.Source info --base 2>$null | Select-Object -First 1)
            $ErrorActionPreference = $previousErrorActionPreference
            $condaRoot = if ($condaRoot) { $condaRoot.ToString().Trim() } else { "" }
            $condaPython = if ($condaRoot) { Join-Path $condaRoot "python.exe" } else { "" }
            if ($condaPython -and (Test-PythonExecutable $condaPython)) { $pythonCommand = $condaPython }
        }
    }
    if (-not $pythonCommand) {
        throw "Python 3.10+ was not found. Install Python and retry: .\scripts\demo.ps1"
    }
}

$arguments = @("$(Join-Path $rootDir 'scripts\community_demo.py')")
if ($InitOnly) { $arguments += "--init-only" }
if ($Help) { $arguments += "--help" }

& $pythonCommand @arguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
