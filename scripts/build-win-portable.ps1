$ErrorActionPreference = "Stop"
Write-Host "==> [1/4] Building application to out/..." -ForegroundColor Cyan
bun run build
$dist = "release/C-CodeX-Win-Portable"
$zipPath = "release/C-CodeX-Win-Portable.zip"
Write-Host "==> [2/4] Preparing Windows Portable directory from node_modules/electron/dist..." -ForegroundColor Cyan
if (Test-Path $dist) {
    Remove-Item -Recurse -Force $dist
}
if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}
Copy-Item -Recurse "node_modules/electron/dist" $dist
Write-Host "==> [3/4] Copying compiled app into resources/app..." -ForegroundColor Cyan
Remove-Item "$dist/resources/default_app.asar" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$dist/resources/app" | Out-Null
Copy-Item -Recurse "out" "$dist/resources/app/out"
'{"name":"ccodex-desktop","version":"1.0.0","type":"module","main":"./out/main/index.js"}' | Set-Content -Encoding UTF8 "$dist/resources/app/package.json"
Write-Host "==> [4/4] Renaming executable and creating release/C-CodeX-Win-Portable.zip..." -ForegroundColor Cyan
Rename-Item "$dist/electron.exe" "C-CodeX Desktop.exe"
Compress-Archive -Path "$dist/*" -DestinationPath $zipPath -Force
Write-Host "==> Done! Windows Portable app created at:" -ForegroundColor Green
Write-Host "    Folder : $dist"
Write-Host "    Zip    : $zipPath"