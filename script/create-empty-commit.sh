#!/usr/bin/env bash

TARGET_REPO=${1}
WORKING_DIR=${2}
COMMIT_MSG=${3}
cd ${WORKING_DIR}

IFS="/" read -a urlarray <<< "$TARGET_REPO"
REPO_NAME=$(echo ${urlarray[4]} | cut -f1 -d'.')
git clone ${TARGET_REPO}
cd ${REPO_NAME}
git commit --allow-empty -m "${COMMIT_MSG}"
git push -u origin master
cd ..
rm -rf ${REPO_NAME}
