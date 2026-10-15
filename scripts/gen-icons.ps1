# gen-icons.ps1 — 生成黄色渐变圆角图标（含下载箭头），输出 16/48/128 PNG
Add-Type -AssemblyName System.Drawing

$dir = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function New-RoundedPath([int]$s, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc(0, 0, $d, $d, 180, 90)
    $p.AddArc($s - $d, 0, $d, $d, 270, 90)
    $p.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
    $p.AddArc(0, $s - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

foreach ($s in @(16, 48, 128)) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $r = [single]($s * 0.22)
    $path = New-RoundedPath $s $r

    $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 255, 229, 59),
        [System.Drawing.Color]::FromArgb(255, 255, 152, 0),
        [single]135)
    $g.FillPath($brush, $path)

    # 下载箭头
    $penW = [single][Math]::Max(1.0, $s / 9.0)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 74, 46, 0), $penW)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $cx = [single]($s / 2.0)
    $top = [single]($s * 0.26)
    $bottom = [single]($s * 0.70)
    $half = [single]($s * 0.16)

    $g.DrawLine($pen, $cx, $top, $cx, $bottom)
    $g.DrawLine($pen, $cx, $bottom, $cx - $half, $bottom - $half)
    $g.DrawLine($pen, $cx, $bottom, $cx + $half, $bottom - $half)
    $g.DrawLine($pen, $cx - [single]($s * 0.22), $bottom, $cx + [single]($s * 0.22), $bottom)

    $pen.Dispose()
    $brush.Dispose()
    $path.Dispose()
    $g.Dispose()

    $out = Join-Path $dir ("icon{0}.png" -f $s)
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("generated: " + $out)
}
