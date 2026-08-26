$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repo ".env"
$runtime = Join-Path $repo ".traceforge\operational\runtime.env"

if (-not (Test-Path $target)) { throw "Missing $target" }
$targetValues = @{}
foreach ($line in [IO.File]::ReadAllLines($target)) {
  if ($line -match '^([^#=]+)=(.*)$') { $targetValues[$matches[1]] = $matches[2] }
}
$required = @("PGHOST","PGPORT","PGDATABASE","PGUSER","PGSCHEMA","PGPASSWORD")
foreach ($name in $required) { if (-not $targetValues[$name]) { throw "$name is missing from $target" } }
if ($targetValues.PGPASSWORD -eq 'CHANGE_ME') { throw "Set PGPASSWORD in $target before running this script" }
$password = $targetValues.PGPASSWORD
$encodedUser = [Uri]::EscapeDataString($targetValues.PGUSER)
$encodedPassword = [Uri]::EscapeDataString($password)
$encodedSchema = [Uri]::EscapeDataString($targetValues.PGSCHEMA)
$databaseUrl = "postgresql://${encodedUser}:${encodedPassword}@$($targetValues.PGHOST):$($targetValues.PGPORT)/$($targetValues.PGDATABASE)?options=-c%20search_path%3D${encodedSchema}"
$uri = [Uri]$databaseUrl
$env:PGPASSWORD = $password
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
& $psql -w -h $uri.Host -p $uri.Port -U $targetValues.PGUSER -d postgres -tAc "SELECT 1" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL authentication failed on port 5432" }

$databaseExists = & $psql -w -h $uri.Host -p $uri.Port -U $targetValues.PGUSER -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$($targetValues.PGDATABASE)'"
if ($databaseExists -ne "1") {
  & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -w -h $uri.Host -p $uri.Port -U $targetValues.PGUSER $targetValues.PGDATABASE
  if ($LASTEXITCODE -ne 0) { throw "Could not create the traceforge database" }
}
& $psql -w -h $uri.Host -p $uri.Port -U $targetValues.PGUSER -d $targetValues.PGDATABASE -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS $($targetValues.PGSCHEMA) AUTHORIZATION $($targetValues.PGUSER)"
if ($LASTEXITCODE -ne 0) { throw "Could not create the TraceForge schema" }

$runtimeLines = [Collections.Generic.List[string]]::new()
foreach ($line in [IO.File]::ReadAllLines($runtime)) {
  if ($line -notmatch '^(DATABASE_URL|TEST_DATABASE_URL)=') { $runtimeLines.Add($line) }
}
$runtimeLines.Insert(0, "TEST_DATABASE_URL=$databaseUrl")
$runtimeLines.Insert(0, "DATABASE_URL=$databaseUrl")
[IO.File]::WriteAllLines($runtime, $runtimeLines, [Text.UTF8Encoding]::new($false))
& icacls $runtime /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null

foreach ($line in $runtimeLines) {
  if ($line -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process") }
}
Push-Location $repo
try { npm run db:migrate; if ($LASTEXITCODE -ne 0) { throw "TraceForge database migration failed" } } finally { Pop-Location }
"TraceForge PostgreSQL configured at 127.0.0.1:5432 database traceforge, schema $($targetValues.PGSCHEMA)"
