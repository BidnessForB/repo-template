#!/usr/bin/env bash
cd ~/dev/test
source_repo=${1}
target_repo=${2}
IFS="/" read -a urlarray <<< "$source_repo"
repo_name=$(echo ${urlarray[4]} | cut -f1 -d'.')
git clone ${source_repo}
cd repo-template
rm -rf .git
git init
git add -f *
git commit -m 'Initial commit of copied resources'
git remote add origin ${target_repo}
git pull origin master
git push -u origin master
rm -rf ${repo_name}
cd ~/dev/test
rm -rf ${repo_name}
