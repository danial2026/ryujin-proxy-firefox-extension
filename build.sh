#!/bin/bash

set -e

VERSION=$(grep '"version"' manifest.json | sed -E 's/.*"version": "([^: "([^"]+)".*/\1/')
NAME=$(grep '"name"' manifest.json | sed -E 's/.*"name": "([^"]+)".*/\1/' | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
DIST_DIR="dist"
BUILD_DIR="web-ext-artifacts"
TMP_BUILD="/tmp/ryujin-proxy-build-$$"

echo "Building ${NAME} v${VERSION}"

PROD=false
if [[ "$1" == "--prod" ]]; then
    PROD=true
fi

rm -rf "${DIST_DIR}" "${BUILD_DIR}"
mkdir -p "${DIST_DIR}"

if [[ "$PROD" == true ]]; then
    echo "Production build..."

    # Create clean build directory with only extension files
    rm -rf "${TMP_BUILD}"
    mkdir -p "${TMP_BUILD}"

    # Copy only required files
    cp manifest.json "${TMP_BUILD}/"
    cp -r src "${TMP_BUILD}/"
    cp -r assets "${TMP_BUILD}/"

    npx web-ext build --source-dir="${TMP_BUILD}" --artifacts-dir="${BUILD_DIR}" --overwrite-dest

    ZIP_FILE=$(ls "${BUILD_DIR}"/*.zip 2>/dev/null | head -1)
    if [[ -f "$ZIP_FILE" ]]; then
        NEW_NAME="${DIST_DIR}/${NAME}-v${VERSION}.xpi"
        mv "$ZIP_FILE" "$NEW_NAME"
        echo "Created: ${NEW_NAME}"
        ls -lh "${NEW_NAME}"
    else
        echo "Error: No XPI file generated"
        exit 1
    fi

    # Cleanup
    rm -rf "${TMP_BUILD}"
else
    echo "Development build..."
    echo "Files ready in project root for 'Load Temporary Add-on'"
    echo ""
    echo "To install:"
    echo "  1. Open about:debugging in Firefox"
    echo "  2. Click 'This Firefox'"
    echo "  3. Click 'Load Temporary Add-on'"
    echo "  4. Select manifest.json"
fi

echo "Done"