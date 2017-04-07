#!/usr/bin/env bash

#/ args: host repo org
host=${1}
repo=${2}
org=${3}
mkdir -p ../working/${host}/${repo}
cd ../working/${host}/${repo}
echo "Repository updated by repo-template" >> repo-template.md
git init
git add repo-template.md
git commit -m 'First commit by repo-template'
echo ${host} ${org} ${repo}
git remote add origin https://${host}/${org}/${repo}.git
git push -u origin master


