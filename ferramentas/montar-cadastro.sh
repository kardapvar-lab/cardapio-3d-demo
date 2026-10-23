#!/bin/sh
# Empacota cadastro-lib.mjs (gltf-transform + meshoptimizer + modelo.mjs) em ../cadastro/lib.js,
# que o cadastrar.html carrega. Rode depois de mexer no modelo.mjs.
# (precisa do npm install do preparar-scans.mjs e de: npm install esbuild@0.24.0)
set -e
cd "$(dirname "$0")"
npx esbuild cadastro-lib.mjs --bundle --format=esm --minify --target=safari15 --outfile=../cadastro/lib.js
