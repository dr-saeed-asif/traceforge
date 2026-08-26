$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo "docs\TRACEFORGE_WORKFLOW_AND_INTEGRATION_GUIDE.md"
$output = Join-Path $repo "docs\TraceForge_Workflow_and_Integration_Guide.docx"
$pdf = Join-Path $repo "docs\TraceForge_Workflow_and_Integration_Guide.pdf"

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

function Set-Font($range, [string]$name, [double]$size, [int]$color, [bool]$bold = $false, [bool]$italic = $false) {
  $range.Font.Name = $name
  $range.Font.Size = $size
  $range.Font.Color = $color
  $range.Font.Bold = [int]$bold
  $range.Font.Italic = [int]$italic
}

function Add-Paragraph($doc, [string]$text, [string]$style = "Normal") {
  $p = $doc.Paragraphs.Add()
  $p.Range.Text = $text
  try { $p.Range.Style = $style } catch {}
  $p.Range.InsertParagraphAfter() | Out-Null
  return $p
}

function Clean-Inline([string]$text) {
  $value = $text -replace '\*\*([^*]+)\*\*', '$1'
  $value = $value -replace '`([^`]+)`', '$1'
  $value = $value -replace '\[([^]]+)\]\([^)]+\)', '$1'
  return $value
}

try {
  $doc = $word.Documents.Add()
  $section = $doc.Sections.Item(1)
  $section.PageSetup.PaperSize = 2
  $section.PageSetup.TopMargin = 72
  $section.PageSetup.BottomMargin = 72
  $section.PageSetup.LeftMargin = 72
  $section.PageSetup.RightMargin = 72
  $section.PageSetup.HeaderDistance = 35.4
  $section.PageSetup.FooterDistance = 35.4

  $normal = $doc.Styles.Item("Normal")
  $normal.Font.Name = "Calibri"
  $normal.Font.Size = 11
  $normal.Font.Color = 0
  $normal.ParagraphFormat.SpaceBefore = 0
  $normal.ParagraphFormat.SpaceAfter = 6
  $normal.ParagraphFormat.LineSpacingRule = 5
  $normal.ParagraphFormat.LineSpacing = 13.75

  $heading1 = $doc.Styles.Item("Heading 1")
  $heading1.Font.Name = "Calibri"
  $heading1.Font.Size = 16
  $heading1.Font.Bold = -1
  $heading1.Font.Color = 11826734
  $heading1.ParagraphFormat.SpaceBefore = 18
  $heading1.ParagraphFormat.SpaceAfter = 10
  $heading1.ParagraphFormat.KeepWithNext = -1

  $heading2 = $doc.Styles.Item("Heading 2")
  $heading2.Font.Name = "Calibri"
  $heading2.Font.Size = 13
  $heading2.Font.Bold = -1
  $heading2.Font.Color = 11826734
  $heading2.ParagraphFormat.SpaceBefore = 14
  $heading2.ParagraphFormat.SpaceAfter = 7
  $heading2.ParagraphFormat.KeepWithNext = -1

  $heading3 = $doc.Styles.Item("Heading 3")
  $heading3.Font.Name = "Calibri"
  $heading3.Font.Size = 12
  $heading3.Font.Bold = -1
  $heading3.Font.Color = 7884063
  $heading3.ParagraphFormat.SpaceBefore = 10
  $heading3.ParagraphFormat.SpaceAfter = 5
  $heading3.ParagraphFormat.KeepWithNext = -1

  $header = $section.Headers.Item(1).Range
  $header.Text = "TRACEFORGE  /  ENGINEERING REFERENCE GUIDE"
  Set-Font $header "Calibri" 9 7368816 $true
  $header.ParagraphFormat.Alignment = 0

  $footer = $section.Footers.Item(1).Range
  $footer.Text = "TraceForge - Observable AI Engineering Evidence  |  "
  Set-Font $footer "Calibri" 8.5 7368816
  $footer.ParagraphFormat.Alignment = 2
  $footer.Collapse(0)
  $footer.Fields.Add($footer, 33) | Out-Null

  $coverSpacer = Add-Paragraph $doc ""
  $coverSpacer.Format.SpaceAfter = 82
  $kicker = Add-Paragraph $doc "TECHNICAL REFERENCE GUIDE"
  Set-Font $kicker.Range "Calibri" 11 11826734 $true
  $kicker.Alignment = 1
  $kicker.Format.SpaceAfter = 18
  $title = Add-Paragraph $doc "TraceForge"
  Set-Font $title.Range "Calibri" 30 4732160 $true
  $title.Alignment = 1
  $title.Format.SpaceAfter = 4
  $subtitle = Add-Paragraph $doc "Workflow and Integration Guide"
  Set-Font $subtitle.Range "Calibri" 17 7884063
  $subtitle.Alignment = 1
  $subtitle.Format.SpaceAfter = 22
  $tagline = Add-Paragraph $doc "Observable, redacted, ordered, and tamper-evident evidence for AI-assisted engineering"
  Set-Font $tagline.Range "Calibri" 11 7368816 $false $true
  $tagline.Alignment = 1
  $tagline.Format.SpaceAfter = 88
  $meta = Add-Paragraph $doc "OpenCode  |  Ollama  |  Hosted Providers  |  Custom AI Agents"
  Set-Font $meta.Range "Calibri" 10.5 11826734 $true
  $meta.Alignment = 1
  $meta.Format.SpaceAfter = 8
  $version = Add-Paragraph $doc "TraceForge v0.1 - Engineering Documentation"
  Set-Font $version.Range "Calibri" 9.5 7368816
  $version.Alignment = 1

  $end = $doc.Content
  $end.Collapse(0)
  $end.InsertBreak(7)

  $tocTitle = Add-Paragraph $doc "Contents" "Heading 1"
  $tocRange = $doc.Range($doc.Content.End - 1, $doc.Content.End - 1)
  $doc.TablesOfContents.Add($tocRange, $true, 1, 3) | Out-Null
  $tocEnd = $doc.Content
  $tocEnd.Collapse(0)
  $tocEnd.InsertBreak(7)

  $lines = Get-Content $source
  $inCode = $false
  $codeType = ""
  $codeLines = [Collections.Generic.List[string]]::new()
  $i = 0
  while ($i -lt $lines.Count) {
    $line = $lines[$i]
    if ($line -match '^```(.*)$') {
      if (-not $inCode) {
        $inCode = $true
        $codeType = $matches[1]
        $codeLines.Clear()
      } else {
        $p = Add-Paragraph $doc ($codeLines -join "`r")
        Set-Font $p.Range "Consolas" 8.5 3158064
        $p.Format.LeftIndent = 12
        $p.Format.RightIndent = 12
        $p.Format.SpaceBefore = 5
        $p.Format.SpaceAfter = 8
        $p.Format.KeepTogether = -1
        $p.Range.Shading.BackgroundPatternColor = if ($codeType -eq "mermaid") { 15790320 } else { 15921906 }
        $inCode = $false
        $codeType = ""
      }
      $i++
      continue
    }
    if ($inCode) { $codeLines.Add($line); $i++; continue }
    if ($i -eq 0 -and $line -match '^# ') { $i++; continue }
    if ($line -match '^### (.+)$') { Add-Paragraph $doc (Clean-Inline $matches[1]) "Heading 3" | Out-Null; $i++; continue }
    if ($line -match '^## (.+)$') { Add-Paragraph $doc (Clean-Inline $matches[1]) "Heading 1" | Out-Null; $i++; continue }
    if ($line -match '^# (.+)$') { Add-Paragraph $doc (Clean-Inline $matches[1]) "Heading 1" | Out-Null; $i++; continue }

    if ($line -match '^\|.*\|$' -and $i + 1 -lt $lines.Count -and $lines[$i + 1] -match '^\|[\s:|-]+\|$') {
      $rows = [Collections.Generic.List[object]]::new()
      $headerCells = @($line.Trim('|').Split('|') | ForEach-Object { (Clean-Inline $_.Trim()) })
      $rows.Add($headerCells)
      $i += 2
      while ($i -lt $lines.Count -and $lines[$i] -match '^\|.*\|$') {
        $rows.Add(@($lines[$i].Trim('|').Split('|') | ForEach-Object { (Clean-Inline $_.Trim()) }))
        $i++
      }
      $columnCount = $headerCells.Count
      $range = $doc.Range($doc.Content.End - 1, $doc.Content.End - 1)
      $table = $doc.Tables.Add($range, $rows.Count, $columnCount)
      $table.AllowAutoFit = $false
      $table.PreferredWidthType = 2
      $table.PreferredWidth = 468
      $table.Rows.Item(1).HeadingFormat = -1
      $table.Borders.Enable = 1
      $table.Range.Font.Name = "Calibri"
      $table.Range.Font.Size = 9
      $table.Range.ParagraphFormat.SpaceAfter = 2
      $table.Range.Cells.VerticalAlignment = 1
      for ($r = 1; $r -le $rows.Count; $r++) {
        for ($c = 1; $c -le $columnCount; $c++) {
          $value = if ($c -le $rows[$r - 1].Count) { $rows[$r - 1][$c - 1] } else { "" }
          $table.Cell($r, $c).Range.Text = $value
          if ($r -eq 1) {
            $table.Cell($r, $c).Range.Font.Bold = -1
            $table.Cell($r, $c).Shading.BackgroundPatternColor = 15132390
          }
        }
      }
      if ($columnCount -eq 2) {
        $table.Columns.Item(1).Width = 135
        $table.Columns.Item(2).Width = 333
      } else {
        for ($c = 1; $c -le $columnCount; $c++) { $table.Columns.Item($c).Width = 468 / $columnCount }
      }
      $afterTable = $doc.Range($doc.Content.End - 1, $doc.Content.End - 1)
      $afterTable.InsertParagraphAfter()
      continue
    }

    if ($line -match '^[-*] (.+)$') {
      $p = Add-Paragraph $doc (Clean-Inline $matches[1])
      $p.Range.ListFormat.ApplyBulletDefault()
      $p.Format.LeftIndent = 36
      $p.Format.FirstLineIndent = -18
      $p.Format.SpaceAfter = 4
      $i++
      continue
    }
    if ($line -match '^\d+\. (.+)$') {
      $p = Add-Paragraph $doc (Clean-Inline $matches[1])
      $p.Range.ListFormat.ApplyNumberDefault()
      $p.Format.LeftIndent = 36
      $p.Format.FirstLineIndent = -18
      $p.Format.SpaceAfter = 4
      $i++
      continue
    }
    if ([string]::IsNullOrWhiteSpace($line)) { $i++; continue }
    Add-Paragraph $doc (Clean-Inline $line) | Out-Null
    $i++
  }

  foreach ($toc in $doc.TablesOfContents) { $toc.Update() | Out-Null }
  $doc.Fields.Update() | Out-Null
  try { $doc.BuiltInDocumentProperties.Item("Title").Value = "TraceForge Workflow and Integration Guide" } catch {}
  try { $doc.BuiltInDocumentProperties.Item("Subject").Value = "TraceForge architecture, workflow, security, files, use cases, and AI integrations" } catch {}
  try { $doc.BuiltInDocumentProperties.Item("Author").Value = "TraceForge Engineering" } catch {}
  $doc.SaveAs2($output, 16)
  $doc.ExportAsFixedFormat($pdf, 17)
  $doc.Close()
  try { $word.Quit() } catch {}
  [Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null
  [Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  Write-Output $output
  Write-Output $pdf
} catch {
  try { if ($doc) { $doc.Close(0) } } catch {}
  try { $word.Quit() } catch {}
  throw
}
