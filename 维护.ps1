param(
  [ValidateSet('test','check','build-code','build-offline')][string]$Action='test'
)
$ErrorActionPreference='Stop'
$env:PYTHONIOENCODING='utf-8'
$root=$PSScriptRoot
$index=Join-Path $root '本地资源\assets.local.json'
$node=$null; $python=$null
if(Test-Path -LiteralPath $index){
  $assets=Get-Content -LiteralPath $index -Raw -Encoding UTF8 | ConvertFrom-Json
  $base=Join-Path $root $assets.voice
  $candidate=Join-Path $base 'runtime\node\node.exe'
  if(Test-Path -LiteralPath $candidate){$node=$candidate}
  $candidate=Join-Path $base 'runtime\python311\python.exe'
  if(Test-Path -LiteralPath $candidate){$python=$candidate}
}
if(-not $node){$node=(Get-Command node -ErrorAction Stop).Source}
if(-not $python){$python=(Get-Command python -ErrorAction Stop).Source}
Push-Location -LiteralPath $root
try {
  if($Action -eq 'test'){
    & $node (Join-Path $root 'scripts\test.mjs')
  } elseif($Action -eq 'check'){
    & $node (Join-Path $root 'scripts\sync-shared.mjs') --check
    if($LASTEXITCODE -ne 0){throw 'Shared source check failed'}
    & $python -I -B (Join-Path $root 'scripts\check.py')
  } else {
    & $node (Join-Path $root 'scripts\sync-shared.mjs') --check
    if($LASTEXITCODE -ne 0){throw 'Shared source check failed'}
    $buildArgs=@('-I','-B',(Join-Path $root 'scripts\build.py'))
    if($Action -eq 'build-code'){$buildArgs+='--code-only'}
    & $python @buildArgs
  }
  if($LASTEXITCODE -ne 0){throw ('Maintenance command failed: '+$LASTEXITCODE)}
} finally {Pop-Location}
