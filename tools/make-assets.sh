#!/usr/bin/env bash
#
# This script assumes a linux/OSX environment



DES=$1/assets

echo "*** Packaging assets in $DES... "

rm -rf $DES
cp -R ./assets $DES/

VERSION=$(cat ./dist/version)
# ADN - no need for us to use dev assets for dev build, but it is something we can implement later.
# if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
#     echo "*** Removing $DES/assets.dev.json"
#     rm $DES/assets.dev.json
# else
#     echo "*** Removing $DES/assets.json"
#     rm $DES/assets.json
# fi
echo "*** Removing $DES/assets.dev.json"
rm $DES/assets.dev.json

mkdir $DES/thirdparties

ASSETS_MAIN=dist/build/uAssets/main
ASSETS_PROD=dist/build/uAssets/prod

cp -R $ASSETS_MAIN/thirdparties/pgl.yoyo.org     $DES/thirdparties/
cp -R $ASSETS_MAIN/thirdparties/publicsuffix.org $DES/thirdparties/
cp -R $ASSETS_MAIN/thirdparties/urlhaus-filter   $DES/thirdparties/

mkdir -p $DES/thirdparties/easylist
cp $ASSETS_PROD/thirdparties/easylist.txt $DES/thirdparties/easylist/
cp $ASSETS_PROD/thirdparties/easyprivacy.txt $DES/thirdparties/easylist/

cp -R ./thirdparties/www.eff.org                                 $DES/thirdparties/ # ADN

# mkdir $DES/ublock
cp $ASSETS_PROD/filters/* $DES/ublock/

# Optional filter lists: do not include in package
rm $DES/ublock/annoyances.txt
rm $DES/ublock/lan-block.txt
rm $DES/ublock/ubol-filters.txt

# ADN
cp -R ./filters/adnauseam.txt                                    $DES/ublock/

