#!/usr/bin/env bash
SOURCE_REPO=${1}
TARGET_REPO=${2}
WORKING_DIR=${3}
cd ${WORKING_DIR}
IFS="/" read -a urlarray <<< "$SOURCE_REPO"
SOURCE_REPO_NAME=$(echo ${urlarray[4]} | cut -f1 -d'.')
IFS="/" read -a urlarray <<< "$TARGET_REPO"
TARGET_REPO_NAME=$(echo ${urlarray[4]} | cut -f1 -d'.')
echo "TARGET: ${TARGET_REPO_NAME}"
echo "SOURCE: ${SOURCE_REPO_NAME}"
git clone ${SOURCE_REPO}
git clone ${TARGET_REPO}
rm -rf ${SOURCE_REPO_NAME}/.git
mv -v ${SOURCE_REPO_NAME}/* ${TARGET_REPO_NAME}
cd ${TARGET_REPO_NAME}
if [ -e "./README.md" ]; then
    echo -e "_NOTE:_ Repository copied by repo-template from ${SOURCE_REPO}\r\n\r\n$(cat README.md)" > README.md
else
    echo "_NOTE:_ Repository copied by repo-template from ${SOURCE_REPO}" > README.md
fi
git add -f *
git commit -m 'Initial commit of copied resources'
git push -u origin master
cd ..
rm -rf ${TARGET_REPO_NAME}
rm -rf ${SOURCE_REPO_NAME}
