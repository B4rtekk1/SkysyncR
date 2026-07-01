$Source = "./config.yaml"
$Destinations = @(
    "../backend/config.yaml",
    "../frontend/web/config.yaml"
)

foreach ($dest in $Destinations)
{
    Copy-Item -Path $Source -Destination $dest -Force
    Write-Host "Copied $Source to $dest" -ForegroundColor Green
}

Write-Host "All copies completed successfully."