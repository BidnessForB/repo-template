#!/usr/bin/env bash
npm install
echo "creating log directory"
mkdir -p log
echo "Creating jobs directory"
mkdir -p jobs
cp config/job-template-example.json config/job-template.json
echo "Remember to edit config/job-template.json and, optionally,"
echo "test/test-params.json with correct default values"
