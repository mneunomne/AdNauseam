#!/bin/sh

VERSION=$1


if [[ -z $(git status -s) ]]
then
  echo "Merging to uBlock $VERSION"
  git fetch --all --tags --prune
  git checkout tags/$VERSION
  git checkout -b upstream$VERSION
  git checkout master
  git checkout -b merge$VERSION
  git merge upstream$VERSION
else
  echo "There are uncommited changes, make sure you commit them before starting your merge"
fi


