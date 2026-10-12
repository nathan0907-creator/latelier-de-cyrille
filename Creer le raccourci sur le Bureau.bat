@echo off
rem Cree sur le Bureau un raccourci "L'atelier de Cyrille" : un double-clic demarre le site
rem et l'ouvre dans le navigateur. A relancer si vous deplacez ce dossier ou si vous
rem l'installez sur un autre ordinateur.
cd /d "%~dp0"

powershell -NoProfile -Command "$s = New-Object -ComObject WScript.Shell; $l = $s.CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'L''atelier de Cyrille.lnk')); $l.TargetPath = '%~dp0Ouvrir le site.bat'; $l.WorkingDirectory = '%~dp0'; $l.IconLocation = '%~dp0public\img\icone.ico,0'; $l.Description = 'Ouvrir le site de L''atelier de Cyrille'; $l.Save()"

echo.
if errorlevel 1 (
  echo   Le raccourci n'a pas pu etre cree.
) else (
  echo   Raccourci "L'atelier de Cyrille" cree sur le Bureau.
)
echo.
pause
