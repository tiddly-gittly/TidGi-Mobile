$token = gh auth token
$artifactUrl = "https://api.github.com/repos/tiddly-gittly/TidGi-Mobile/actions/artifacts/7621914135/zip"

# Step 1: Follow redirect manually to get the real download URL
try {
    $response = Invoke-WebRequest -Uri $artifactUrl -Headers @{Authorization="Bearer $token"} -MaximumRedirection 0 -SkipHttpErrorCheck -ErrorAction Stop
    $location = $response.Headers.Location
} catch {
    if ($_.Exception.Response) {
        $location = $_.Exception.Response.Headers.Location
    }
}

if (-not $location) {
    Write-Host "Failed to get redirect location"
    exit 1
}

Write-Host "Redirect: $($location.Substring(0, [Math]::Min(80, $location.Length)))..."

# Step 2: Download from the real storage URL via SOCKS5 proxy
$outFile = "$env:TEMP\apks-real.zip"
Remove-Item $outFile -ErrorAction SilentlyContinue

Invoke-WebRequest -Uri $location -OutFile $outFile -Proxy "socks5://127.0.0.1:1080"

$size = (Get-Item $outFile).Length
Write-Host "Downloaded: $size bytes"

if ($size -gt 1000000) {
    $extractDir = "$env:TEMP\apks-real"
    Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
    Expand-Archive -Force $outFile -DestinationPath $extractDir
    Get-ChildItem $extractDir -Recurse -File -Filter "*.apk" | ForEach-Object {
        Write-Host "APK: $($_.Name) ($($_.Length) bytes)"
        # Copy to e2e artifacts
        $destDir = "I:\github\TidGi-Mobile\e2e\artifacts\apks"
        Copy-Item $_.FullName -Destination "$destDir\$($_.Name)" -Force
        Write-Host "  → copied to $destDir\$($_.Name)"
    }
    Write-Host "Done! APKs ready for install."
} else {
    Write-Host "ERROR: Downloaded file too small ($size bytes), likely not a valid zip"
}
