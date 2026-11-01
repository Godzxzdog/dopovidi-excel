#!/bin/bash
cd "$(dirname "$0")"
echo "=== Доповіді → Excel ==="
echo ""
echo "Сервер запускається. Відкрий у браузері:"
echo "  http://127.0.0.1:8099/"
echo ""
echo "Щоб зупинити — закрий це вікно або натисни Ctrl+C."
echo ""
python3 webapp.py 8099
