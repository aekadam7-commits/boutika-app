#!/data/data/com.termux/files/usr/bin/bash
# تثبيت وتشغيل سيرفر Boutika على الهاتف (Android + Termux)
set -e
pkg update -y && pkg install -y nodejs git
termux-setup-storage || true          # لمنح صلاحية بطاقة SD / التخزين المشترك
cd "$(dirname "$0")/.."
npm install --omit=dev
# لتوسعة التخزين: ضع البيانات على التخزين المشترك أو بطاقة SD
export BOUTIKA_DATA="${BOUTIKA_DATA:-$HOME/storage/shared/Boutika}"
mkdir -p "$BOUTIKA_DATA"
termux-wake-lock 2>/dev/null || true  # يمنع النظام من إيقاف السيرفر
echo "البيانات في: $BOUTIKA_DATA"
node src/server.js
