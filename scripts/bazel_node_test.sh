#!/bin/sh
# Runs one node:test file for `bazel test`: $1 is Bazel's node, $2 the test file.
# The runfiles tree is symlinks; keep Node from following them back into the source
# tree, so `new URL("../web/...", import.meta.url)` finds the files Bazel provided.
set -eu
node=$1
shift
exec "$node" --preserve-symlinks --preserve-symlinks-main --test "$@"
