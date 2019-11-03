#!/bin/bash -e
cd "$(dirname "$0")/.."

pwd

OIFS="$IFS"
IFS=$'\n'

for f in $(\
  find . -type f -name '*.png' \
  -not -path "*/node_modules/*" \
  -not -path "./.git/*" \
  -not -path "*/_*" )
do
  echo "$f"
  TMPNAME=$(dirname "$f")/.$(basename "$f").tmp
  (pngcrush -q "$f" "$TMPNAME" && mv -f "$TMPNAME" "$f") &
done

for f in $(\
  find . -type f -name '*.svg' \
  -not -path "*/node_modules/*" \
  -not -path "./.git/*" \
  -not -path "*/_*" )
do
  echo "$f"
  svgo --multipass -q "$f" &
done

IFS="$OIFS"

wait
