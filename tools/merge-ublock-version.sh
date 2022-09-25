#!/bin/sh

VERSION=$1

echo "Merging to uBlock $VERSION"

if [[ -z $(git status -s) ]]
then
  echo "STAGED!!!"
else
  echo "TEST!!!"
fi


