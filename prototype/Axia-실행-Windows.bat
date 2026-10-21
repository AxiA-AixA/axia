@echo off
chcp 65001 > NUL
set PYTHONUTF8=1
cd /d "%~dp0"
where python > NUL 2> NUL
if errorlevel 1 goto nopython
python -c "import PIL" 2> NUL
if errorlevel 1 python -m pip install --quiet pillow
python app.py
pause
exit /b
:nopython
echo Python이 없어요. python.org 에서 설치하고 "Add python.exe to PATH"를 체크한 뒤 다시 실행하세요.
pause
