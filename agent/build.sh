#!/usr/bin/env bash
# Build ai-cockpit-agent for this machine (bin/) and, with --all, for macOS/Linux/Windows (dist/).
set -euo pipefail
cd "$(dirname "$0")"
go test ./...
go build -trimpath -ldflags "-s -w" -o ../bin/ai-cockpit-agent .
echo "bin/ai-cockpit-agent"
if [ "${1:-}" = "--all" ]; then
  mkdir -p ../dist
  for target in darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64; do
    os="${target%/*}" arch="${target#*/}" ext=""
    [ "$os" = windows ] && ext=".exe"
    CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags "-s -w" -o "../dist/ai-cockpit-agent-$os-$arch$ext" .
    echo "dist/ai-cockpit-agent-$os-$arch$ext"
  done
fi
