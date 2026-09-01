﻿﻿# DSH CodeGraph Visualizer 安装脚本
# 用于在 DSH web profile 中安装本插件

param(
    [string]$Source = "github",  # github | local | npm
    [string]$RepoUrl = "https://github.com/xuanyuanchumo/dsh-codegraph-visualizer.git",
    [string]$LocalPath = "D:\Projects\TraeProjects\dsh-codegraph-visualizer"
)

$DSH_HOME = $env:DSH_HOME
if (-not $DSH_HOME) {
    $DSH_HOME = "$env:USERPROFILE\.dsh"
}

$ProfilePath = "$DSH_HOME\profiles\web"
Write-Host "DSH Profile Path: $ProfilePath" -ForegroundColor Green

# 1. 安装插件依赖
Write-Host "`n[1/4] Installing plugin dependencies..." -ForegroundColor Yellow

if ($Source -eq "github") {
    Write-Host "Installing from GitHub: $RepoUrl"
    # 从 GitHub 安装
    pushd $ProfilePath
    dsh plugin --profile web add "$RepoUrl"
    popd
}
elseif ($Source -eq "local") {
    Write-Host "Installing from local path: $LocalPath"
    # 从本地安装
    pushd $ProfilePath
    dsh plugin --profile web add "file://$LocalPath"
    popd
}
else {
    Write-Host "Installing from npm"
    pushd $ProfilePath
    dsh plugin --profile web add dsh-codegraph-visualizer
    popd
}

# 2. 更新 cordis.patch.yml
Write-Host "`n[2/4] Updating cordis.patch.yml..." -ForegroundColor Yellow

$PatchFile = "$ProfilePath\cordis.patch.yml"
$PatchContent = @"
# CodeGraph Visualizer bundle patch
# Applied after dsh-base and dsh-web-app layers; inserts this plugin as a
# host-plane row so its graph_* tools register into the global `tools` registry.
- insert:
    - id: codegraph-visualizer
      name: dsh-codegraph-visualizer
"@

if (Test-Path $PatchFile) {
    $Existing = Get-Content $PatchFile -Raw
    if ($Existing -notmatch "codegraph-visualizer") {
        Add-Content $PatchFile -Value "`n$PatchContent"
        Write-Host "Added codegraph-visualizer to cordis.patch.yml" -ForegroundColor Green
    }
    else {
        Write-Host "codegraph-visualizer already in cordis.patch.yml" -ForegroundColor Cyan
    }
}
else {
    New-Item -Path $PatchFile -ItemType Force -Value $PatchContent
    Write-Host "Created cordis.patch.yml" -ForegroundColor Green
}

# 3. 更新 package.json
Write-Host "`n[3/4] Updating package.json..." -ForegroundColor Yellow

$PackageFile = "$ProfilePath\package.json"
$Package = Get-Content $PackageFile | ConvertFrom-Json

# 添加依赖
if (-not $Package.dependencies."dsh-codegraph-visualizer") {
    if ($Source -eq "github") {
        $Package.dependencies | Add-Member -NotePropertyName "dsh-codegraph-visualizer" -NotePropertyValue "$RepoUrl"
    }
    elseif ($Source -eq "local") {
        $Package.dependencies | Add-Member -NotePropertyName "dsh-codegraph-visualizer" -NotePropertyValue "file:$LocalPath"
    }
    else {
        $Package.dependencies | Add-Member -NotePropertyName "dsh-codegraph-visualizer" -NotePropertyValue "^2.1.0"
    }
    $Package | ConvertTo-Json -Depth 10 | Set-Content $PackageFile
    Write-Host "Added dsh-codegraph-visualizer to dependencies" -ForegroundColor Green
}
else {
    Write-Host "dsh-codegraph-visualizer already in dependencies" -ForegroundColor Cyan
}

# 添加到 bundles
if ($Package.dsh.profile.bundles -notcontains "dsh-codegraph-visualizer") {
    $Package.dsh.profile.bundles += "dsh-codegraph-visualizer"
    $Package | ConvertTo-Json -Depth 10 | Set-Content $PackageFile
    Write-Host "Added dsh-codegraph-visualizer to bundles" -ForegroundColor Green
}
else {
    Write-Host "dsh-codegraph-visualizer already in bundles" -ForegroundColor Cyan
}

# 4. 重新安装依赖
Write-Host "`n[4/4] Reinstalling dependencies..." -ForegroundColor Yellow
pushd $ProfilePath
dsh plugin --profile web install
popd

Write-Host "`n✅ Installation complete!" -ForegroundColor Green
Write-Host "`nTo start DSH Web:" -ForegroundColor Cyan
Write-Host "  dsh web" -ForegroundColor White
Write-Host "`nThen navigate to: http://localhost:3080" -ForegroundColor White