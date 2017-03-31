#!/usr/bin/env bash
npm install
echo "creating log directory"
mkdir -p log
echo "Creating jobs directory"
mkdir -p jobs
cp config/job-template-example.json config/job-template.json
cp config/config-example.json config.json
clear
echo "****************************************************************"
echo
echo "Remember to edit config/job-template.json and config/config.json"
echo "Add your PATs and ensure the values make sense for your environment"
echo
echo "****************************************************************"


