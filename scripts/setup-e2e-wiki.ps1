Push-Location "I:\github\TidGi-Mobile"
$tmp = [System.IO.Path]::GetTempFileName() + ".json"
'{"state":{"customWikiFolderPath":"file:///storage/emulated/0/Documents/TidGi/","defaultWorkspaceId":"wiki-mpr4q4u6","workspaces":[{"id":"wiki-mpr4q4u6","name":"E2E Wiki","type":"wiki","wikiFolderLocation":"file:///storage/emulated/0/Documents/TidGi/wikis/wiki-mpr4q4u6","isSubWiki":false,"order":0,"mainWikiID":null,"syncedServers":[]}]},"version":1}' | Out-File -Encoding UTF8 $tmp
adb push $tmp /data/local/tmp/wiki-storage.json
adb shell run-as ren.onetwo.tidgi.mobile.test cp /data/local/tmp/wiki-storage.json /data/data/ren.onetwo.tidgi.mobile.test/files/persistStorage/wiki-storage
Write-Host "done"
Remove-Item $tmp
