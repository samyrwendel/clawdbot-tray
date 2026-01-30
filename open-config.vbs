Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File config-gui.ps1", 0, False
