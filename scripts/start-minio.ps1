# scripts/start-minio.ps1
# Automates downloading and starting a local MinIO server for local development.

$binDir = "$PSScriptRoot\..\bin"
$dataDir = "$PSScriptRoot\..\data\minio"
$minioExe = "$binDir\minio.exe"

# 1. Create directories if they do not exist
if (!(Test-Path $binDir)) {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Write-Host "Created bin directory: $binDir"
}

if (!(Test-Path $dataDir)) {
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    Write-Host "Created MinIO data directory: $dataDir"
}

# 2. Download MinIO if not present
if (!(Test-Path $minioExe)) {
    Write-Host "MinIO binary not found. Downloading MinIO server (Windows 64-bit)..."
    $url = "https://dl.min.io/server/minio/release/windows-amd64/minio.exe"
    
    try {
        # Use curl.exe directly as it's faster and less prone to progress-bar slows than Invoke-WebRequest
        curl.exe -L -o $minioExe $url
        Write-Host "Successfully downloaded MinIO server to $minioExe"
    } catch {
        Write-Error "Failed to download MinIO server: $_"
        exit 1
    }
} else {
    Write-Host "MinIO server binary already exists at $minioExe"
}

# 3. Set environment variables for MinIO root access
$env:MINIO_ROOT_USER = "minioadmin"
$env:MINIO_ROOT_PASSWORD = "minioadmin"

# 4. Start MinIO server
Write-Host "Starting MinIO Server..."
Write-Host "  S3 Endpoint: http://localhost:9000"
Write-Host "  Web Console: http://localhost:9001"
Write-Host "  Data Dir:    $dataDir"
Write-Host "Press Ctrl+C to stop the server."

# Start the MinIO process
& $minioExe server $dataDir --address ":9000" --console-address ":9001"
