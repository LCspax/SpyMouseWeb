param(
  [string]$MapsDir = "assets\maps",
  [string]$OutDir  = "assets\masks",
  [int]$Cell = 16,
  [int]$ColorTol = 85,
  [int]$CloseRadius = 5,
  [int]$ChromaTol = 60,
  [switch]$Individual,
  [switch]$BackgroundsOnly
)

Add-Type -AssemblyName System.Drawing

$cs = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WalkMask {
    public static string Run(string src, string outJson, string outPng, int cell, int colorTol, int closeR, int chromaTol) {
        using (var bmp = new Bitmap(src)) {
            int w = bmp.Width, h = bmp.Height;
            var rect = new Rectangle(0, 0, w, h);
            var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            byte[] px = new byte[stride * h];
            Marshal.Copy(data.Scan0, px, 0, px.Length);
            bmp.UnlockBits(data);

            // Label every pixel with a "color region": flood fill from unlabelled
            // pixels using colour distance to the seed colour. Keep the largest.
            int[] label = new int[w * h];
            for (int i = 0; i < label.Length; i++) label[i] = -1;
            var stack = new Stack<int>();
            int[] dx = { 1, -1, 0, 0 }, dy = { 0, 0, 1, -1 };
            var comps = new List<List<int>>();
            var colors = new List<int[]>();

            for (int sy = (int)(h * 0.12); sy < h * 0.88; sy += 8) {
                for (int sx = (int)(w * 0.12); sx < w * 0.88; sx += 8) {
                    int s0 = sy * w + sx;
                    if (label[s0] != -1) continue;
                    int si = sy * stride + sx * 4;
                    int r = px[si + 2], g = px[si + 1], b = px[si];
                    int tol = colorTol;
                    var comp = new List<int>();
                    stack.Push(s0); label[s0] = comps.Count;
                    while (stack.Count > 0) {
                        int cur = stack.Pop();
                        comp.Add(cur);
                        int cx = cur % w, cy = cur / w;
                        for (int k = 0; k < 4; k++) {
                            int nx = cx + dx[k], ny = cy + dy[k];
                            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                            int ni = ny * w + nx;
                            if (label[ni] != -1) continue;
                            int pi = ny * stride + nx * 4;
                            int d = Math.Abs(px[pi + 2] - r) + Math.Abs(px[pi + 1] - g) + Math.Abs(px[pi] - b);
                            if (d > tol) continue;
                            label[ni] = comps.Count;
                            stack.Push(ni);
                        }
                    }
                    comps.Add(comp);
                    colors.Add(new int[] { r, g, b });
                }
            }

            // Region picks: (A) the region under the image centre / central band,
            // (B) the largest region that does not touch the border (room floor).
            // Use B when it is clearly larger than A (handles gradient floors).
            var touchesBorder = new bool[comps.Count];
            for (int x = 0; x < w; x++) {
                int a = label[x], b2 = label[(h - 1) * w + x];
                if (a >= 0) touchesBorder[a] = true;
                if (b2 >= 0) touchesBorder[b2] = true;
            }
            for (int y = 0; y < h; y++) {
                int a = label[y * w], b2 = label[y * w + (w - 1)];
                if (a >= 0) touchesBorder[a] = true;
                if (b2 >= 0) touchesBorder[b2] = true;
            }

            long minSize = (long)(w * h) * 2 / 100;
            int centerIdx = (h / 2) * w + (w / 2);
            int cr = label[centerIdx];
            int candA = -1;
            if (cr >= 0 && comps[cr].Count >= minSize) {
                candA = cr;
            } else {
                int bx0 = (int)(w * 0.35), bx1 = (int)(w * 0.65);
                int by0 = (int)(h * 0.35), by1 = (int)(h * 0.65);
                long bestN = -1;
                for (int c = 0; c < comps.Count; c++) {
                    if (comps[c].Count < minSize) continue;
                    bool overlaps = false;
                    foreach (int p in comps[c]) {
                        int x = p % w, y = p / w;
                        if (x >= bx0 && x < bx1 && y >= by0 && y < by1) { overlaps = true; break; }
                    }
                    if (overlaps && comps[c].Count > bestN) { bestN = comps[c].Count; candA = c; }
                }
            }

            int candB = -1;
            long bestB = -1;
            for (int c = 0; c < comps.Count; c++) {
                if (touchesBorder[c]) continue;
                if (comps[c].Count > bestB) { bestB = comps[c].Count; candB = c; }
            }

            int chosen = candA;
            long sizeA = candA >= 0 ? comps[candA].Count : 0;
            if (candB >= 0 && bestB > sizeA * 3 / 2 && bestB >= minSize) chosen = candB;
            if (chosen < 0) chosen = (candB >= 0 ? candB : (cr >= 0 ? cr : -1));

            var best = new bool[w * h];
            int bestCount = 0, br = 128, bgc = 128, bb = 128;
            if (chosen >= 0) {
                foreach (int c in comps[chosen]) best[c] = true;
                bestCount = comps[chosen].Count;
                br = colors[chosen][0]; bgc = colors[chosen][1]; bb = colors[chosen][2];
            }

            // Extend the floor into darker/lighter variants with the same hue
            // (carpets, rugs and shaded areas share chromaticity with the floor).
            {
                double fsum2 = br + bgc + bb; if (fsum2 < 1) fsum2 = 1;
                double fcr = br / fsum2, fcg = bgc / fsum2;
                double flum = 0.299 * br + 0.587 * bgc + 0.114 * bb; if (flum < 1) flum = 1;
                bool[] ext = (bool[])best.Clone();
                var q2 = new Queue<int>();
                for (int y = 0; y < h; y++)
                    for (int x = 0; x < w; x++) {
                        int i = y * w + x;
                        if (!ext[i]) continue;
                        bool edge = x == 0 || y == 0 || x == w - 1 || y == h - 1 ||
                            !ext[i - 1] || !ext[i + 1] || !ext[i - w] || !ext[i + w];
                        if (edge) q2.Enqueue(i);
                    }
                int[] exx = { 1, -1, 0, 0 }, exy = { 0, 0, 1, -1 };
                double chTol = chromaTol / 1000.0;
                while (q2.Count > 0) {
                    int cur = q2.Dequeue();
                    int cx = cur % w, cy = cur / w;
                    for (int k = 0; k < 4; k++) {
                        int nx = cx + exx[k], ny = cy + exy[k];
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        int ni = ny * w + nx;
                        if (ext[ni]) continue;
                        int pi = ny * stride + nx * 4;
                        double r = px[pi + 2], g = px[pi + 1], b = px[pi];
                        double sum = r + g + b; if (sum < 1) continue;
                        double d = Math.Abs(r / sum - fcr) + Math.Abs(g / sum - fcg);
                        double lum = 0.299 * r + 0.587 * g + 0.114 * b;
                        double ratio = lum / flum;
                        if (d <= chTol && ratio >= 0.25 && ratio <= 1.9) { ext[ni] = true; q2.Enqueue(ni); }
                    }
                }
                best = ext;
            }
            // Morphological closing (dilate then erode) to bridge small decorations.
            bool[] dil = (bool[])best.Clone();
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++) {
                    if (best[y * w + x]) continue;
                    bool any = false;
                    for (int oy = -closeR; oy <= closeR && !any; oy += 2)
                        for (int ox = -closeR; ox <= closeR; ox += 2) {
                            int nx = x + ox, ny = y + oy;
                            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                            if (best[ny * w + nx]) { any = true; break; }
                        }
                    dil[y * w + x] = any;
                }
            bool[] closed = (bool[])dil.Clone();
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++) {
                    if (!dil[y * w + x]) continue;
                    bool hole = false;
                    for (int oy = -closeR; oy <= closeR && !hole; oy += 2)
                        for (int ox = -closeR; ox <= closeR; ox += 2) {
                            int nx = x + ox, ny = y + oy;
                            if (nx < 0 || ny < 0 || nx >= w || ny >= h) { hole = true; break; }
                            if (!dil[ny * w + nx]) { hole = true; break; }
                        }
                    closed[y * w + x] = !hole;
                }

            int cols = (w + cell - 1) / cell, rows = (h + cell - 1) / cell;
            var sb = new System.Text.StringBuilder(cols * rows);
            var mb = new Bitmap(cols, rows, PixelFormat.Format32bppArgb);
            for (int gy = 0; gy < rows; gy++)
                for (int gx = 0; gx < cols; gx++) {
                    int on = 0, tot = 0;
                    for (int y = gy * cell; y < Math.Min(h, (gy + 1) * cell); y++)
                        for (int x = gx * cell; x < Math.Min(w, (gx + 1) * cell); x++) {
                            tot++; if (closed[y * w + x]) on++;
                        }
                    bool v = tot > 0 && (on * 2 >= tot);
                    sb.Append(v ? '1' : '0');
                    mb.SetPixel(gx, gy, v ? Color.White : Color.Black);
                }
            mb.Save(outPng, ImageFormat.Png);
            mb.Dispose();

            string json = "{\"cols\":" + cols + ",\"rows\":" + rows + ",\"cell\":" + cell +
                          ",\"width\":" + w + ",\"height\":" + h +
                          ",\"floor\":[" + br + "," + bgc + "," + bb + "]," +
                          "\"data\":\"" + sb.ToString() + "\"}";
            System.IO.File.WriteAllText(outJson, json);
            return "ok " + cols + "x" + rows + " floor=(" + br + "," + bgc + "," + bb + ") area=" + bestCount;
        }
    }
}
'@
Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$outFull = (Resolve-Path $OutDir).Path
if ($Individual) {
  foreach ($imageFile in (Get-ChildItem -LiteralPath $MapsDir -Filter *.jpg)) {
    $floorName = $imageFile.BaseName
    [WalkMask]::Run($imageFile.FullName, (Join-Path $outFull "$floorName.json"), (Join-Path $outFull "$floorName.png"), $Cell, $ColorTol, $CloseRadius, $ChromaTol) | Out-Null
  }
  Write-Output "alternate floor masks generated"
  return
}
# Immutable source segments: assets/maps/_segments/mapNNN/*.jpg. Reading from
# there makes repeated mask runs idempotent (the generated composite in
# assets/maps is never used as an input again).
$segmentRoot = Join-Path $MapsDir "_segments"
$groups = @{}
if (Test-Path $segmentRoot) {
  foreach ($d in Get-ChildItem -Path $segmentRoot -Directory) {
    if ($d.Name -notmatch '^map(\d+)$') { continue }
    $mapNum = $matches[1]
    $list = New-Object System.Collections.ArrayList
    foreach ($f in (Get-ChildItem -Path $d.FullName -Filter *.jpg)) {
      if ($f.BaseName -match '^map(\d+)(?:_(\d+))?$') {
        $suf = 0
        if ($matches[2]) { $suf = [int]$matches[2] }
        [void]$list.Add([PSCustomObject]@{ File = $f; Suffix = $suf })
      }
    }
    if ($list.Count -gt 0) { $groups[$mapNum] = $list }
  }
}
if ($groups.Count -eq 0) {
  foreach ($f in (Get-ChildItem -Path $MapsDir -Filter *.jpg)) {
    if ($f.BaseName -match '^map(\d+)(?:_(\d+))?$') {
      $mapNum = $matches[1]
      $suf = 0
      if ($matches[2]) { $suf = [int]$matches[2] }
      if (-not $groups.ContainsKey($mapNum)) { $groups[$mapNum] = New-Object System.Collections.ArrayList }
      [void]$groups[$mapNum].Add([PSCustomObject]@{ File = $f; Suffix = $suf })
    }
  }
}
$n = 0
foreach ($mapNum in ($groups.Keys | Sort-Object { [int]$_ })) {
  $segs = @($groups[$mapNum] | Sort-Object Suffix)
  $target = $segs[0].File.FullName
  if ($segs.Count -gt 1) {
    $imgs = @()
    $totalW = 0
    $maxH = 0
    foreach ($s in $segs) {
      $img = [System.Drawing.Image]::FromFile($s.File.FullName)
      $imgs += $img
      $totalW += $img.Width
      if ($img.Height -gt $maxH) { $maxH = $img.Height }
    }
    $bmp = New-Object System.Drawing.Bitmap($totalW, $maxH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $x = 0
    foreach ($img in $imgs) {
      $g.DrawImage($img, $x, 0, $img.Width, $img.Height)
      $x += $img.Width
    }
    $g.Dispose()
    # Release the source file locks before overwriting the first segment.
    foreach ($img in $imgs) { $img.Dispose() }
    # The stitched image must replace the level background the game loads
    # (assets/maps/mapNNN.jpg); saving it under assets/masks was the bug.
    $target = Join-Path $MapsDir ("map$mapNum.jpg")
    $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
    Write-Output "stitched map$mapNum : $($segs.Count) segments -> ${totalW}x${maxH}"
  }
  $name = "map$mapNum"
  if ($BackgroundsOnly) { $n++; continue }
  try {
    $res = [WalkMask]::Run($target, (Join-Path $outFull "$name.json"), (Join-Path $outFull "$name.png"), $Cell, $ColorTol, $CloseRadius, $ChromaTol)
    if ($name -eq "map10" -or $name -eq "map703" -or $name -eq "map797" -or $name -eq "map531") { Write-Output "$name : $res" }
    $n++
  } catch {
    Write-Output "$name : ERROR $($_.Exception.Message)"
  }
}
Write-Output "done $n / $($groups.Count)"

