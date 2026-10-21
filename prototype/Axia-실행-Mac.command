#!/bin/bash
cd "$(dirname "$0")"
python3 -c "import PIL" 2>/dev/null || python3 -m pip install --quiet --user pillow
python3 app.py
