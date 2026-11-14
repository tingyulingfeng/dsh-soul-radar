# 灵魂雷达 · 各渠道数据快照
#
# 用法：
#   .\check-stats.ps1            # 只打印，不写文件
#   .\check-stats.ps1 -Save      # 追加一份到 docs\数据基线.md
#
# 为什么要它：GitHub 的流量数据只保留 14 天，npm 的下载统计也只给窗口期。
# 隔几天记一次，才看得出「提了 PR 之后有没有效果」。
#
# 需要 GITHUB_TOKEN 环境变量（读 traffic 接口要求 push 权限）。

param(
  [switch]$Save
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = 'tingyulingfeng/dsh-soul-radar'
$pkg = 'dsh-soul-radar'
$curl = 'C:\Windows\System32\curl.exe'
$lines = New-Object System.Collections.Generic.List[string]

function Say($s) { Write-Host "  $s"; $lines.Add($s) }

Say "## $((Get-Date).ToString('yyyy-MM-dd HH:mm'))"
Say ""

# ── GitHub 仓库指标 ──────────────────────────────────────────
$hdr = @{ 'User-Agent' = 'dsh'; 'Accept' = 'application/vnd.github+json' }
if ($env:GITHUB_TOKEN) { $hdr['Authorization'] = "Bearer $env:GITHUB_TOKEN" }

Say "### GitHub"
try {
  $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo" -Headers $hdr -TimeoutSec 15
  Say "- stars: $($r.stargazers_count)"
  Say "- forks: $($r.forks_count)"
  Say "- watchers: $($r.subscribers_count)"
  Say "- open issues: $($r.open_issues_count)"
  Say "- size: $($r.size) KB"
  Say "- pushed: $($r.pushed_at)"
} catch {
  Say "- 仓库信息读取失败：$($_.Exception.Message.Split([char]10)[0])"
}

# ── GitHub 流量（14 天窗口）──────────────────────────────────
if ($env:GITHUB_TOKEN) {
  try {
    $v = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/traffic/views" -Headers $hdr -TimeoutSec 15
    Say "- views (14d): $($v.count) 次 / $($v.uniques) 人"
  } catch { Say "- views: 读不到（HTTP $($_.Exception.Response.StatusCode.value__)）" }
  try {
    $c = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/traffic/clones" -Headers $hdr -TimeoutSec 15
    Say "- clones (14d): $($c.count) 次 / $($c.uniques) 人"
  } catch { Say "- clones: 读不到" }
} else {
  Say "- views / clones: 跳过（没有 GITHUB_TOKEN）"
}
Say ""

# ── npm ─────────────────────────────────────────────────────
Say "### npm"
try {
  $m = Invoke-RestMethod -Uri "https://registry.npmjs.org/$pkg" -TimeoutSec 15
  $versions = @($m.versions.PSObject.Properties.Name)
  Say "- latest: $($m.'dist-tags'.latest)"
  Say "- versions: $($versions.Count) 个（$($versions[0]) … $($versions[-1])）"
  Say "- created: $($m.time.created)"
} catch {
  Say "- registry 读取失败"
}
foreach ($period in @('last-day', 'last-week', 'last-month')) {
  $r = & $curl -sS --max-time 10 "https://api.npmjs.org/downloads/point/$period/$pkg" 2>$null
  if ($r -match '"downloads":(\d+)') {
    Say "- $period : $($Matches[1])"
  } else {
    Say "- $period : 查不到（包还没被统计索引收录）"
  }
}
# 能不能被搜到
$s = & $curl -sS --max-time 10 "https://registry.npmjs.org/-/v1/search?text=$pkg&size=5" 2>$null
if ($s -match "`"name`":`"$pkg`"") {
  Say "- npm 搜索: ✓ 已收录"
} else {
  Say "- npm 搜索: ✗ 还没收录"
}
Say ""

# ── 社区索引 ────────────────────────────────────────────────
Say "### 社区索引"
$idx = & $curl -sS --max-time 12 "https://registry.npmjs.org/dsh-plugin-catalog" 2>$null
if ($idx -match '"latest"') {
  Say "- dsh-plugin-catalog: 在 npm 上（查询自己的条目需要下载整个索引）"
} else {
  Say "- dsh-plugin-catalog: 查不到"
}
# 2026-11-14：#15262 已提、等 review。第一版 #15171 被关，原因是提 PR 时仓库才 19.6 小时，
# 不满 awesome 的「创建满 1 天」硬门槛。合并之后再改成「已收录」。
Say "- awesome-dsh-plugin: PR #15262 已提，等 review（仓库 $repo 建于 2026-11-13 19:44）"
Say ""

# ── 其他渠道 ────────────────────────────────────────────────
Say "### 其他"
Say "- Hugging Face: 未发布（插件是代码，不走 HF；语料库另议）"
Say "- 知乎/贴吧等：未宣传"
Say ""

$block = ($lines -join "`n")

if ($Save) {
  $out = Join-Path $root 'docs\数据基线.md'
  $header = @"
# 数据基线

每次跑 ``check-stats.ps1 -Save`` 就往下面追加一段。看趋势用，不要看单点。

时间越早的越靠上。

---

"@
  if (-not (Test-Path $out)) {
    [System.IO.File]::WriteAllText($out, $header, (New-Object System.Text.UTF8Encoding($false)))
  }
  $existing = [System.IO.File]::ReadAllText($out, [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText(
    $out,
    $existing.TrimEnd() + "`n`n" + $block + "`n",
    (New-Object System.Text.UTF8Encoding($false))
  )
  Write-Host ""
  Write-Host "  已追加到 docs\数据基线.md" -ForegroundColor Green
  Write-Host ""
}
