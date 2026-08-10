param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('inventory', 'apply', 'verify')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'

$sourceRef = 'bkbxzdbthxwccdfcwsub'
$targetRef = 'ilboytxdlydyrrdnwlon'
$temporaryEnvironmentNames = @(
  'MIGRATION_SOURCE_HOST',
  'MIGRATION_SOURCE_PORT',
  'MIGRATION_SOURCE_USER',
  'MIGRATION_SOURCE_PASSWORD',
  'MIGRATION_SOURCE_DATABASE',
  'MIGRATION_SOURCE_URL',
  'MIGRATION_SOURCE_SERVICE_ROLE_KEY',
  'MIGRATION_TARGET_HOST',
  'MIGRATION_TARGET_PORT',
  'MIGRATION_TARGET_USER',
  'MIGRATION_TARGET_PASSWORD',
  'MIGRATION_TARGET_DATABASE',
  'MIGRATION_TARGET_URL',
  'MIGRATION_TARGET_ANON_KEY',
  'MIGRATION_TARGET_SERVICE_ROLE_KEY',
  'MIGRATION_APPLY_CONFIRMED'
)

function Get-TemporaryDatabaseCredential {
  param([Parameter(Mandatory = $true)][string]$ProjectRef)

  $linkOutput = & npx supabase link --project-ref $ProjectRef --yes 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to link Supabase project $ProjectRef"
  }

  $dryRunOutput = & npx supabase db dump --linked --dry-run 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to obtain a temporary database credential for $ProjectRef"
  }

  $credential = @{}
  foreach ($name in @('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE')) {
    $match = [regex]::Match($dryRunOutput, "export $name=`"([^`"]+)`"")
    if (-not $match.Success) {
      throw "Temporary credential output for $ProjectRef is missing $name"
    }
    $credential[$name] = $match.Groups[1].Value
  }
  return $credential
}

function Get-ProjectApiKeys {
  param([Parameter(Mandatory = $true)][string]$ProjectRef)

  $keysOutput = & npx supabase projects api-keys --project-ref $ProjectRef --reveal --output json 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to retrieve API keys for $ProjectRef"
  }
  $keys = $keysOutput | ConvertFrom-Json
  $anon = $keys | Where-Object { $_.name -eq 'anon' -and $_.type -eq 'legacy' } | Select-Object -First 1
  $serviceRole = $keys | Where-Object { $_.name -eq 'service_role' -and $_.type -eq 'legacy' } | Select-Object -First 1
  if (-not $anon.api_key -or -not $serviceRole.api_key) {
    throw "Legacy anon/service_role keys are unavailable for $ProjectRef"
  }
  return @{ Anon = $anon.api_key; ServiceRole = $serviceRole.api_key }
}

function Set-MigrationDatabaseEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$Prefix,
    [Parameter(Mandatory = $true)][hashtable]$Credential
  )

  Set-Item "Env:MIGRATION_${Prefix}_HOST" $Credential.PGHOST
  Set-Item "Env:MIGRATION_${Prefix}_PORT" $Credential.PGPORT
  Set-Item "Env:MIGRATION_${Prefix}_USER" $Credential.PGUSER
  Set-Item "Env:MIGRATION_${Prefix}_PASSWORD" $Credential.PGPASSWORD
  Set-Item "Env:MIGRATION_${Prefix}_DATABASE" $Credential.PGDATABASE
}

try {
  $sourceCredential = Get-TemporaryDatabaseCredential -ProjectRef $sourceRef
  $targetCredential = Get-TemporaryDatabaseCredential -ProjectRef $targetRef
  $sourceKeys = Get-ProjectApiKeys -ProjectRef $sourceRef
  $targetKeys = Get-ProjectApiKeys -ProjectRef $targetRef

  Set-MigrationDatabaseEnvironment -Prefix 'SOURCE' -Credential $sourceCredential
  Set-MigrationDatabaseEnvironment -Prefix 'TARGET' -Credential $targetCredential
  $env:MIGRATION_SOURCE_URL = "https://$sourceRef.supabase.co"
  $env:MIGRATION_TARGET_URL = "https://$targetRef.supabase.co"
  $env:MIGRATION_SOURCE_SERVICE_ROLE_KEY = $sourceKeys.ServiceRole
  $env:MIGRATION_TARGET_ANON_KEY = $targetKeys.Anon
  $env:MIGRATION_TARGET_SERVICE_ROLE_KEY = $targetKeys.ServiceRole
  if ($Mode -eq 'apply') {
    $env:MIGRATION_APPLY_CONFIRMED = 'YES'
  }

  & node scripts/supabase-investment-migration/run.mjs --mode $Mode
  if ($LASTEXITCODE -ne 0) {
    throw "Migration runner failed in $Mode mode"
  }
}
finally {
  foreach ($name in $temporaryEnvironmentNames) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
  & npx supabase link --project-ref $sourceRef --yes 2>&1 | Out-Null
}
