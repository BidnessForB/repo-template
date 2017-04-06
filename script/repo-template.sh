#!/usr/bin/env bash

#/Usage:  repo-template.sh cmd <options>
#/
#/  Create a copy of a repository from a configuration file.  You can configure
#/  repo-template to:
#/
#/        - Create a repository
#/        - Add teams and individuals as collaborators
#/        - Create branches
#/        - Configure branch protection
#/
#/ COMMANDS:
#/
#/  start	Start the repo-template server
#/
#/  stop	Stop the repo-template server
#/
#/  tunnel  Start an Nginx proxy.
#/
#/  suspend	Stop the repo-template server from resopnding to requests
#/
#/  resume	Unsuspend the repo-template server so that it resopnds to requests
#/
#/  status  Return whether the server is suspended or responding to commands
#/
#/  reloadRepoConfigs Reload repository configurations
#/
#/  create-repo targetHost newRepoName repoConfigName <ownerName | orgName>
#/
#/
#/ OPTIONS:
#/
#/  targetHost              GitHub.com or a GHE server
#/
#/  newRepoName             Name for the new repository
#/
#/  repoConfigName          Configuration file stored in ./config/repo_templates
#/                          to use in creating the new repository
#/
#/  ownerName               Name of a GitHub user to own the new repo
#/
#/  orgName                 Name of a GitHub org to own the new repo (necessary
#/                          for configurations that assign teams or restrict access
#/                          to branches to teams or individuals
#/
#/ EXAMPLES:
#/
#/  Start the repo-template server.  Do not respond to webhook events.  Useful for
#/  testing.
#/
#/     repo-template start
#/
#/  Stop the repo-template server:
#/
#/      repo-template stop
#/
#/  Suspend the repo-template server so that it won't respond to requests
#/
#/      repo-template suspend
#/
#/  Resume the repo-template server responding to requests
#/
#/      repo-template resume
#/
#/  Get the status of the repo-template server, whether it is responding to
#/  events or suspended
#/
#/      repo-template status
#/
#/  Reload repository configurations
#/
#/      repo-template reloadRepoConfigs
#/
#/  Create a new repository on 'github.foo.com' named 'NewRepo', using the
#/  parameters defined in ./config/repo_templates/default.json and owned by the
#/  octocat org.
#/
#/      repo-template create-repo github.foo.com NewRepo default octocat
#/
#/
source_dir=$(cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )
source "$source_dir/.env"
echo $USER_1_AUTH_TOKEN

CMD_JSON=""
FLAG_JSON=""
CMD_OPTION=0
for word in $@
do
    #echo "Current word: "$word" N: "$#" dollar1: "$1
     case "$word" in
        create-repo)
            shift
            CMD_JSON="{\"targetHost\":\"${1}\","
            shift
            CMD_JSON=$CMD_JSON"\"newRepoName\":\"${1}\","
            shift
            CMD_JSON=$CMD_JSON"\"configName\":\"${1}\","
            shift
            CMD_JSON=$CMD_JSON"\"orgName\":\"${1}\""
            CMD_OPTION=1
            break
            ;;
        tunnel)
            ./tunnel.sh
            exit 0
            ;;
        start)
            echo "Starting repo-template server"
            clear
            cd ..
            node repo-template.js
            exit 0
            ;;
        stop|suspend|resume|status)
            echo "Attempting to ${1} repo-template server"
            curl -X GET ${REPO_TEMPLATE_URL}/${1}
            exit 0
            ;;
        *)
            #echo "CMD_OPTION: "$CMD_OPTION
            if [ $CMD_OPTION -eq 0 ]; then
                grep '^#/' <"$0" | cut -c 4-
                echo
                echo "Invalid argument: "$word
                exit 1
            else
                CMD_OPTION=0
            fi
      esac
done


CMD_JSON=$CMD_JSON"}"

echo "CMD_JSON: "$CMD_JSON

curl -X POST -d ${CMD_JSON} -H "Authorization: token ${USER_1_AUTH_TOKEN}" -H "User-Agent: repo-template" -H 'Accept: application/vnd.github.v3.raw' ${REPO_TEMPLATE_URL}"/createRepo"

exit 0

