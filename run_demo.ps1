$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$frontendRoot = Join-Path $projectRoot 'frontend'
$viteEntry = Join-Path $frontendRoot 'node_modules\vite\bin\vite.js'
$chromaPath = Join-Path $projectRoot 'chroma_db'
$logRoot = Join-Path $projectRoot '.demo'

if (-not (Test-Path -LiteralPath $viteEntry)) {
    throw 'Frontend dependencies are missing. Run: cd frontend; npm ci'
}
if (-not (Test-Path -LiteralPath $chromaPath)) {
    throw 'ChromaDB index is missing. Run: python -m src.task4_chunking_indexing'
}

$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $venvPython) {
    $pythonCommand = $venvPython
} else {
    $pythonCommand = (Get-Command python -ErrorAction Stop).Source
}
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$env:PYTHONUTF8 = '1'

$backend = $null
$frontend = $null
try {
    $backend = Start-Process `
        -FilePath $pythonCommand `
        -ArgumentList @('-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000') `
        -WorkingDirectory $projectRoot `
        -RedirectStandardOutput (Join-Path $logRoot 'backend.out.log') `
        -RedirectStandardError (Join-Path $logRoot 'backend.err.log') `
        -PassThru `
        -WindowStyle Hidden

    $frontend = Start-Process `
        -FilePath $nodeCommand `
        -ArgumentList @($viteEntry, '--host', '127.0.0.1', '--port', '5173', '--strictPort') `
        -WorkingDirectory $frontendRoot `
        -RedirectStandardOutput (Join-Path $logRoot 'frontend.out.log') `
        -RedirectStandardError (Join-Path $logRoot 'frontend.err.log') `
        -PassThru `
        -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(30)
    do {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)

    if (-not $health -or $health.status -ne 'ok') {
        throw 'Backend did not become ready. Check .demo/backend.err.log'
    }

    Write-Host ''
    Write-Host 'CampusIQ demo is ready:' -ForegroundColor Green
    Write-Host '  Frontend: http://127.0.0.1:5173'
    Write-Host '  API docs: http://127.0.0.1:8000/docs'
    Write-Host '  Health:   http://127.0.0.1:8000/health'
    Write-Host ''
    Read-Host 'Press Enter to stop the demo'
} finally {
    foreach ($process in @($frontend, $backend)) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        }
    }
}
