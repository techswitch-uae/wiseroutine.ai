#!/usr/bin/env bash
# Hosted macOS runners require explicit trust for third-party dependencies.
# Trust these formulae only, never the entire tap or a global bypass.
set -euo pipefail
brew tap tursodatabase/tap
brew tap libsql/sqld
brew trust --formula tursodatabase/tap/turso
brew trust --formula libsql/sqld/sqld
brew install tursodatabase/tap/turso
