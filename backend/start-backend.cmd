@echo off
cd /d "%~dp0"
set DATABASE_URL=postgres://draft:draft@localhost:5432/fantasy_draft
set PORT=4000
set CLIENT_ORIGIN=http://localhost:5173
"C:\Users\derek\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" src/server.js > backend.out.log 2> backend.err.log
