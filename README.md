# repo-template

Utility server which accepts requests to create new repositories based on 
configuration files.  

### Getting Started

1. Clone the repository
2. Run ./script/bootstrap.sh
3. Edit config.json and add your properly scoped GitHub PAT.  
4. Run ./script/repo_template.sh to start the server  
    `./script/repo_template.sh start`
5. Run ./script/repo-template.sh with appropriate arguments to create a new 
   repository  
    `./script/repo_template.sh create-repository create-repo targetHost newRepoName repoConfigName <ownerName | orgName>`
    
### Usage
Usage:  repo-template.sh cmd

  Create a copy of a repository from a configuration file.  You can configure
  repo-template to:

        - Create a repository
        - Add teams and individuals as collaborators
        - Create branches
        - Configure branch protection

 COMMANDS:

  start	Start the repo-template server

  stop	Stop the repo-template server

  suspend	Stop the repo-template server from resopnding to requests

  resume	Unsuspend the repo-template server so that it resopnds to requests

  status  Return whether the server is suspended or responding to commands

  create-repo targetHost newRepoName repoConfigName <ownerName | orgName>


 OPTIONS:

  targetHost              GitHub.com or a GHE server

  newRepoName             Name for the new repository

  repoConfigName          Configuration file stored in ./config/repo_templates
                          to use in creating the new repository

  ownerName               Name of a GitHub user to own the new repo

  orgName                 Name of a GitHub org to own the new repo (necessary
                          for configurations that assign teams or restrict access
                          to branches to teams or individuals

 EXAMPLES:

  Start the repo-template server.  Do not respond to webhook events.  Useful for
  testing.

     repo-template start

  Stop the repo-template server:

      repo-template stop

  Suspend the repo-template server so that it won't respond to requests

      repo-template suspend

  Resume the repo-template server responding to requests

      repo-template resume

  Get the status of the repo-template server, whether it is responding to
  events or suspended

      repo-template status

  Create a new repository on 'github.foo.com' named 'NewRepo', using the
  parameters defined in ./config/repo_templates/default.json and owned by the
  octocat org.

      repo-template create-repo github.foo.com NewRepo default octocat

    
    
    