#!/usr/bin/env bash
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install --omit=dev
# export BOUTIKA_DATA=/mnt/disk/boutika   # لتوسعة التخزين على قرص آخر
node src/server.js
