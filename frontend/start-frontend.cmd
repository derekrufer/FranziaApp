@echo off
cd /d "%~dp0"
set PORT=5173
"C:\Users\derek\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" serve-dist.mjs > frontend-static.out.log 2> frontend-static.err.log
