# DSH 更新后把灵魂雷达装回去。
#
# 用法：DSH 更新完，双击桌面上的「灵魂雷达-更新后修复.cmd」。
#
# 两条自洁规则：
#   ① 只有**真的修了东西**才删自己；什么都没坏就留着，方便再跑
#   ② 备份只留最近 3 个，不让 package.json.bak-* 堆成山

$ErrorActionPreference = 'Stop'
$profile = "C:\Users\49743\.dsh\profiles\desktop"
$src     = "C:\Users\49743\Desktop\情绪雷达（暂定）辅助插件集\plugin-release"
$name    = "dsh-soul-radar"
$keepBaks = 3

Write-Host ""
Write-Host "  灵魂雷达 · 更新后修复"
Write-Host "  ======================================"

$fixed = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]

# ── 1. 源码还在吗 ──────────────────────────────────────────
if (-not (Test-Path "$src\package.json")) {
  Write-Host "  [x] 源码目录不见了：$src" -ForegroundColor Red
  Write-Host "      插件装不回来，先确认那个文件夹还在" -ForegroundColor Yellow
  Write-Host ""
  exit 1
}
Write-Host "  [ok] 源码在" -ForegroundColor Green

# ── 2. bundle 列表 ────────────────────────────────────────
$pkgPath = "$profile\package.json"
$pkg = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$bundles = @($pkg.dsh.profile.bundles)

if ($bundles -contains $name) {
  Write-Host "  [ok] bundle 列表里有 $name" -ForegroundColor Green
} else {
  Write-Host "  [fix] bundle 列表里没有 $name，加回去" -ForegroundColor Yellow
  $bak = "$pkgPath.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
  Copy-Item -LiteralPath $pkgPath -Destination $bak -Force
  $pkg.dsh.profile.bundles = @($bundles + $name)
  [System.IO.File]::WriteAllText(
    $pkgPath,
    ($pkg | ConvertTo-Json -Depth 20),
    (New-Object System.Text.UTF8Encoding($false))
  )
  $fixed.Add("把 $name 加回 dsh.profile.bundles")
  $notes.Add("备份：$bak")

  # 只留最近几个备份，别堆
  $baks = @(Get-ChildItem -Path $profile -Filter "package.json.bak-*" |
    Sort-Object LastWriteTime -Descending)
  if ($baks.Count -gt $keepBaks) {
    $baks | Select-Object -Skip $keepBaks | ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }
    $notes.Add("顺手清了 $($baks.Count - $keepBaks) 个旧备份（只留 $keepBaks 个）")
  }
}

# ── 3. node_modules 链接 ──────────────────────────────────
$link = "$profile\node_modules\$name"
if (Test-Path $link) {
  $item = Get-Item $link -Force
  if ($item.LinkType -and $item.Target) {
    Write-Host "  [ok] 链接在（$($item.LinkType)）" -ForegroundColor Green
  } else {
    Write-Host "  [ok] 目录在（不是链接，可能是复制的）" -ForegroundColor Green
  }
} else {
  Write-Host "  [fix] 链接没了，重建 junction" -ForegroundColor Yellow
  New-Item -ItemType Junction -Path $link -Target $src -Force | Out-Null
  $fixed.Add("重建 node_modules\$name 的 junction")
}

# ── 4. 版本对一下（只提示）─────────────────────────────────
$localVer = (Get-Content -LiteralPath "$src\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version
Write-Host "  本地版本：$localVer"
$remote = & "C:\Windows\System32\curl.exe" -sS --max-time 8 `
  "https://registry.npmjs.org/-/package/$name/dist-tags" 2>$null
if ($remote -match '"latest"\s*:\s*"([^"]+)"') {
  Write-Host "  npm 上的：$($Matches[1])"
  if ($Matches[1] -ne $localVer) {
    $notes.Add("本地 $localVer，npm 上 $($Matches[1]) —— 想升级就重装一次")
  }
}

# ── 5. 跑一遍工具 ─────────────────────────────────────────
Write-Host ""
Write-Host "  验证四个工具……"
# 自动找正在跑的那个 DSH：更新可能换目录（实测从 D:\AI\dsh 换到 D:\AI\新建文件夹），
# 写死路径的脚本会在下一次更新后失效。
$env:ELECTRON_RUN_AS_NODE = "1"
$node = (Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path } | Select-Object -First 1).Path
if (-not $node -or -not (Test-Path $node)) {
  # 没在跑就退回常见位置
  $node = @(
    "D:\AI\dsh\DeepSeek Harness.exe",
    "D:\AI\新建文件夹\DeepSeek Harness.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $node) { Write-Host "  [x] 找不到 DeepSeek Harness.exe" -ForegroundColor Red; exit 1 }
Write-Host "  用这个 node：$node" -ForegroundColor DarkGray
$probe = @'
const idx = await import('file:///C:/Users/49743/Desktop/情绪雷达（暂定）辅助插件集/plugin-release/index.js')
const t = new Map()
idx.apply({ tools: { register: (d) => t.set(d.name, d) } })
console.log('TOOLS|' + [...t.keys()].sort().join(', '))
const r = await t.get('lt_score').execute({ title: 't', body: '风很大。\n她没说话。\n我走了。' })
const txt = typeof r === 'string' ? r : JSON.stringify(r)
console.log('NEWSECTION|' + (txt.includes('话由你说') ? 'yes' : 'no'))
const s = JSON.stringify(await t.get('lt_schema').execute({ body: '风很大。\n她没说话。' }))
console.log('SIXCAT|' + (s.includes('景 / 物 / 人 / 事 / 心理 / 环境 / 无') ? 'yes' : 'no'))
'@
$tmp = Join-Path $env:TEMP ("soul-probe-" + [guid]::NewGuid().ToString("N").Substring(0, 6) + ".mjs")
[System.IO.File]::WriteAllText($tmp, $probe, (New-Object System.Text.UTF8Encoding($false)))
$out = & $node $tmp 2>&1 | Out-String
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

if ($out -match 'TOOLS\|(.+)') {
  Write-Host "  [ok] 四个工具：$($Matches[1])" -ForegroundColor Green
} else {
  Write-Host "  [x] 工具加载失败" -ForegroundColor Red
  $notes.Add("工具加载失败，DSH 可能要重启")
}
if ($out -match 'NEWSECTION\|yes') {
  Write-Host "  [ok] 报告里有新那一节" -ForegroundColor Green
} else {
  Write-Host "  [!] 报告里没有新那一节（旧版本？）" -ForegroundColor Yellow
}
if ($out -match 'SIXCAT\|yes') {
  Write-Host "  [ok] 六类分类在" -ForegroundColor Green
} else {
  Write-Host "  [!] 六类分类没找到" -ForegroundColor Yellow
}

# ── 6. 汇总 ───────────────────────────────────────────────
Write-Host ""
if ($fixed.Count) {
  Write-Host "  修了 $($fixed.Count) 处：" -ForegroundColor Yellow
  $fixed | ForEach-Object { Write-Host "    · $_" }
  Write-Host ""
  Write-Host "  **要重启 DSH 才生效**（bundle 只在启动时装载）" -ForegroundColor Yellow
} else {
  Write-Host "  什么都没坏，不用修。" -ForegroundColor Green
}
if ($notes.Count) {
  Write-Host ""
  $notes | ForEach-Object { Write-Host "  · $_" -ForegroundColor DarkGray }
}
Write-Host ""

# ── 7. 只有真修过才删自己 ─────────────────────────────────
if ($fixed.Count -eq 0) {
  Write-Host "  （没修东西，脚本留着，下次还能用）" -ForegroundColor DarkGray
  Write-Host ""
  exit 0
}

$self = $MyInvocation.MyCommand.Path
$icon = Join-Path ([Environment]::GetFolderPath('Desktop')) "灵魂雷达-更新后修复.cmd"
foreach ($f in @($self, $icon)) {
  if ($f -and (Test-Path $f)) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
}
Write-Host "  （修完了，这个脚本已经把自己删掉）" -ForegroundColor DarkGray
Write-Host ""
