#!/usr/bin/env bash
#
# This script assumes a linux environment

set -e
shopt -s extglob

echo "*** AdNauseamLite.mv3: Creating extension"

PLATFORM="chromium"

for i in "$@"; do
  case $i in
    quick)
      QUICK="yes"
      ;;
    full)
      FULL="yes"
      ;;
    firefox)
      PLATFORM="firefox"
      ;;
    chromium)
      PLATFORM="chromium"
      ;;
    AdNauseamLite_+([0-9]).+([0-9]).+([0-9]).+([0-9]))
      TAGNAME="$i"
      FULL="yes"
      ;;
    before=+([[:print:]]))
      BEFORE="${i:7}"
      ;;
  esac
done

echo "PLATFORM=$PLATFORM"
echo "TAGNAME=$TAGNAME"
echo "BEFORE=$BEFORE"

DES="dist/build/AdNauseamLite.$PLATFORM"

if [ "$QUICK" != "yes" ]; then
    rm -rf $DES
fi

mkdir -p $DES
cd $DES
DES=$(pwd)
cd - > /dev/null

mkdir -p "$DES"/css/fonts
mkdir -p "$DES"/js
mkdir -p "$DES"/img

if [ -n "$ADN_VERSION" ]; then
    ADN_REPO="https://github.com/dhowe/AdNauseam.git"
    ADN_DIR=$(mktemp -d)
    echo "*** AdNauseamLite.mv3: Fetching uBO $ADN_VERSION from $ADN_REPO into $ADN_DIR"
    cd "$ADN_DIR"
    git init -q
    git remote add origin "https://github.com/dhowe/AdNauseam.git"
    git fetch --depth 1 origin "$ADN_VERSION"
    git checkout -q FETCH_HEAD
    cd - > /dev/null
else
    ADN_DIR=.
fi

echo "*** AdNauseamLite.mv3: Copying common files"
cp -R "$ADN_DIR"/src/css/fonts/* "$DES"/css/fonts/
cp "$ADN_DIR"/src/css/themes/default.css "$DES"/css/
cp "$ADN_DIR"/src/css/common.css "$DES"/css/
cp "$ADN_DIR"/src/css/dashboard-common.css "$DES"/css/
cp "$ADN_DIR"/src/css/fa-icons.css "$DES"/css/

cp "$ADN_DIR"/src/js/dom.js "$DES"/js/
cp "$ADN_DIR"/src/js/fa-icons.js "$DES"/js/
cp "$ADN_DIR"/src/js/i18n.js "$DES"/js/
cp "$ADN_DIR"/src/js/urlskip.js "$DES"/js/
cp "$ADN_DIR"/src/lib/punycode.js "$DES"/js/

cp -R "$ADN_DIR/src/img/flags-of-the-world" "$DES"/img

cp LICENSE.txt "$DES"/

echo "*** AdNauseamLite.mv3: Copying mv3-specific files"
if [ "$PLATFORM" = "firefox" ]; then
    cp platform/mv3/firefox/background.html "$DES"/
fi
cp platform/mv3/extension/*.html "$DES"/
cp platform/mv3/extension/*.json "$DES"/
cp platform/mv3/extension/css/* "$DES"/css/
cp -R platform/mv3/extension/js/* "$DES"/js/
cp platform/mv3/extension/img/* "$DES"/img/
cp -R platform/mv3/extension/_locales "$DES"/
cp platform/mv3/README.md "$DES/"

if [ "$QUICK" != "yes" ]; then
    echo "*** AdNauseamLite.mv3: Generating rulesets"
    TMPDIR=$(mktemp -d)
    mkdir -p "$TMPDIR"
    if [ "$PLATFORM" = "chromium" ]; then
        cp platform/mv3/chromium/manifest.json "$DES"/
    elif [ "$PLATFORM" = "firefox" ]; then
        cp platform/mv3/firefox/manifest.json "$DES"/
    fi
    ./tools/make-nodejs.sh "$TMPDIR"
    cp platform/mv3/package.json "$TMPDIR"/
    cp platform/mv3/*.js "$TMPDIR"/
    cp platform/mv3/*.mjs "$TMPDIR"/
    cp platform/mv3/extension/js/utils.js "$TMPDIR"/js/
    cp -R "$ADN_DIR"/src/js/resources "$TMPDIR"/js/
    cp "$ADN_DIR"/assets/assets.dev.json "$TMPDIR"/
    cp -R platform/mv3/scriptlets "$TMPDIR"/
    mkdir -p "$TMPDIR"/web_accessible_resources
    cp "$ADN_DIR"/src/web_accessible_resources/* "$TMPDIR"/web_accessible_resources/
    cd "$TMPDIR"
    node --no-warnings make-rulesets.js output="$DES" platform="$PLATFORM"
    if [ -n "$BEFORE" ]; then
        echo "*** AdNauseamLite.mv3: salvaging rule ids to minimize diff size"
        echo "    before=$BEFORE/$PLATFORM"
        echo "    after=$DES"
        node salvage-ruleids.mjs before="$BEFORE"/"$PLATFORM" after="$DES"
    fi
    cd - > /dev/null
    rm -rf "$TMPDIR"
fi

echo "*** AdNauseamLite.mv3: extension ready"
echo "Extension location: $DES/"

# Local build
if [ -z "$TAGNAME" ]; then
    # Enable DNR rule debugging
    tmp=$(mktemp)
    jq '.permissions += ["declarativeNetRequestFeedback"]' \
        "$DES/manifest.json" > "$tmp" \
        && mv "$tmp" "$DES/manifest.json"
    # Use a different extension id than the official one
    if [ "$PLATFORM" = "firefox" ]; then
        tmp=$(mktemp)
        jq '.browser_specific_settings.gecko.id = "adnauseam@rednoise.org"' "$DES/manifest.json"  > "$tmp" \
            && mv "$tmp" "$DES/manifest.json"
    fi
fi

if [ "$FULL" = "yes" ]; then
    EXTENSION="zip"
    if [ "$PLATFORM" = "firefox" ]; then
        EXTENSION="xpi"
    fi
    echo "*** AdNauseamLite.mv3: Creating publishable package..."
    if [ -z "$TAGNAME" ]; then
        TAGNAME="AdNauseamLite_$(jq -r .version "$DES"/manifest.json)"
    else
        tmp=$(mktemp)
        jq --arg version "${TAGNAME:8}" '.version = $version' "$DES/manifest.json"  > "$tmp" \
            && mv "$tmp" "$DES/manifest.json"
    fi
    PACKAGENAME="$TAGNAME.$PLATFORM.mv3.$EXTENSION"
    TMPDIR=$(mktemp -d)
    mkdir -p "$TMPDIR"
    cp -R "$DES"/* "$TMPDIR"/
    cd "$TMPDIR" > /dev/null
    rm -f ./log.txt
    zip "$PACKAGENAME" -qr ./*
    cd - > /dev/null
    cp "$TMPDIR"/"$PACKAGENAME" dist/build/
    rm -rf "$TMPDIR"
    echo "Package location: $(pwd)/dist/build/$PACKAGENAME"
fi
