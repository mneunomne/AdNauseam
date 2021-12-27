#!/usr/bin/env bash
#
# This script assumes a linux/OSX environment



DES=$1/assets

echo "*** Packaging assets in $DES... "

rm -rf $DES
cp -R ./assets $DES/

mkdir $DES/thirdparties

git submodule update --depth 1 --init
UASSETS=submodules/uAssets

cp -R $UASSETS/thirdparties/easylist-downloads.adblockplus.org $DES/thirdparties/
cp -R $UASSETS/thirdparties/pgl.yoyo.org                       $DES/thirdparties/
cp -R $UASSETS/thirdparties/publicsuffix.org                   $DES/thirdparties/
cp -R $UASSETS/thirdparties/urlhaus-filter                     $DES/thirdparties/

cp -R ./thirdparties/www.eff.org                                 $DES/thirdparties/ # ADN

# mkdir $DES/ublock
cp -R $UASSETS/filters/* $DES/ublock/

# Optional filter lists: do not include in package

rm    $DES/ublock/annoyances.txt
cp -R ./filters/adnauseam.txt                                    $DES/ublock/ # ADN

