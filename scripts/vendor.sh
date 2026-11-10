#!/bin/sh
# Fetch the pinned browser libraries into web/vendor/ (checked against sha256s).
# The results are committed, so this is only for changing versions.
# Non-module (global) builds, so index.html works opened straight from disk.
set -eu
cd "$(dirname "$0")/.."
out=web/vendor
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

fetch() { # name version sha256 path-in-package dest
  url="https://registry.npmjs.org/$1/-/$1-$2.tgz"
  curl -fsSL "$url" -o "$tmp/$1.tgz"
  echo "$3  $tmp/$1.tgz" | shasum -a 256 -c - >/dev/null || { echo "checksum mismatch: $url" >&2; exit 1; }
  tar -xzf "$tmp/$1.tgz" -C "$tmp" "package/$4"
  cp "$tmp/package/$4" "$out/$5"
  rm -rf "$tmp/package"
  echo "$out/$5 ($1 $2)"
}

fetch vue 3.5.45 c2ec36a9b719e4277785f1ad36a1bb0424d8d32f0bea24abcce862e26821d585 dist/vue.global.prod.js vue.global.prod.js
fetch gsap 3.15.1 c70a3bcf656015f32b4f6456e686034564c90d64280db535cfbd84de4497d988 dist/gsap.min.js gsap.min.js
fetch tone 15.1.22 86dec0a9521dd69a59e7b824a83b132afd1ef8284bda1e7799449ab9d84d9f62 build/Tone.js Tone.js
fetch canvas-confetti 1.9.4 c7c7d003c8b444d4f8e340e0b2c2a474abf2803ce34d184f783c1107217853e2 dist/confetti.browser.js confetti.browser.js
