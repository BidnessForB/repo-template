#!/usr/bin/env bash
SOURCE_REPO=${1}
TARGET_REPO=${2}
WORKING_DIR=${3}
cd ${WORKING_DIR}
IFS="/" read -a urlarray <<< "$SOURCE_REPO"
REPO_NAME=$(echo ${urlarray[4]} | cut -f1 -d'.')
git clone ${SOURCE_REPO}
cd ${REPO_NAME}
rm -rf .git
rm -rf *
git init
git remote add origin ${TARGET_REPO}
git pull origin master
git add -f *
git commit -m 'Initial commit of copied resources'
git push -u origin master
cd ..
rm -rf ${REPO_NAME}
