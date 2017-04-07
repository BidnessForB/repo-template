# repo-template

Utility server which accepts requests to create new repositories based on 
configuration files.  

### Getting Started

1. Clone the repository
2. Run `./script/bootstrap.sh`
3. Edit `./script/.env` and `./config/config.json` and add your properly scoped GitHub PAT.  
4. Run ./script/repo_template.sh to start the server  
    `./script/repo_template.sh start`
5. Run ./script/repo-template.sh with appropriate arguments to create a new 
   repository  
    `./script/repo_template.sh create-repo targetHost newRepoName repoConfigName <ownerName | orgName>`

### Modes of operation
    
Repo-template can work in several different ways:
    
    1. As a command line tool allowing you to create repositories
    2. By parsing specially formatted Pull Requests, creating repositories when the PRs are merged
    3. In response to the Repository Create event, modifying new repositories.
    
In all cases, you can configure repo-template to:
    
 - Create a repository
 - Add teams and individuals as collaborators
 - Create branches
 - Configure branch protection
    
#### Postman REST API call configurations
If you use [postman](https://www.getpostman.com/docs/) (which is _awesome_), you can import and use
the postman collection stored in `./test/repo-template-postman_collection.json`.  Just be sure to 
replace the place-holders with a properly scoped GitHub PAT.
    
#### Future work
  Some ideas which seem useful include:
  - [ ] Specify an existing repository as a template
  - [ ] Specify a repository and create a configuration file describing it for future use
  - [X] Parse Pull Requests on merge for specific text which would trigger a new repository build.  Parameters to be included in the body of the PR
  - [ ] Include webhooks in configuration of new repositories
  - [X] Manage configuration data in a repository rather than the filesystem.
  
#### TODO
  - [ ] Add tests
  - [X] Add provision for passing username and PAT as part of the request to the server
  - [X] Add provision to flush job log to file.
    
    
### Command line Usage
Usage:  `repo-template.sh cmd <options>`

  Create a copy of a repository from a configuration file.  
  
  - Create a repository
  - Add teams and individuals as collaborators
  - Create branches
  - Configure branch protection
  
 #### COMMANDS

|Command|Description|
|--------|----------|
|`start`|Start the repo-template server.  Returns JSON with the jobID|
|`stop`|Stop the repo-template server|
|`tunnel`|Start an nginix proxy.  Useful for testing webhooks|
|`suspend`|Stop the repo-template server from resopnding to requests|
|`resume`|Unsuspend the repo-template server so that it resopnds to requests|
|`status`|Return whether the server is suspended or responding to commands|
|`reloadRepoConfigs`|Reload repository configurations|
|`reloadConfig`|Reload the server configuration|
|`create-repo targetHost newRepoName repoConfigName orgName`|Create a new repository on 'github.foo.com' named 'NewRepo', using the parameters defined in ./config/repo_templates/default.json and owned by the octocat org.|


 OPTIONS:

|Option|Description|
|------|-----------|
|`targetHost`| GitHub.com or a GHE server|
|`newRepoName`|Name for the new repository|
|`repoConfigName`|Configuration file stored in ./config/repo_templates to use in creating the new repository|
|`ownerName`|Name of a GitHub user to own the new repo|
|`orgName`| Name of a GitHub org to own the new repo (necessary for configurations that assign teams or restrict access to branches to teams or individuals|

 EXAMPLES:

  Start the repo-template server.  

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
      
  Reload repository configurations
        
      repo-template reloadRepoConfigs

  Reload server configuration
        
      repo-template reloadServerConfig

  Create a new repository on 'github.foo.com' named 'NewRepo', using the
  parameters defined in ./config/repo_templates/default.json and owned by the
  octocat org.

      repo-template create-repo github.foo.com NewRepo default octocat

## Calling the Server using REST

All repo template functionality is available through the REST API.

|Endpoint|parameters|Description|
|--------|-----------|----------|
|/repoCreated| - |Endpoint to trap repository create event.  Configure as an organization webhook|
|/suspend| - | Suspend the server|
|/resume| - | Resume the server|
|/pullrequest| - | Endpoint to trap Pull Request merge events.  Configure as a repository webhook|
|/stop| - | Shutdown the server|
|/reloadConfig| - | Reload server configuration files|
|/reloadRepoConfigs| - | Reload repository configuration files|
|/status| `jobID` (optional) - ID of the job for which to report status<br/>`format`-If `'html'` return HTML, otherwise return JSON|Call with no arguments to return whether the server is suspended or not.  Call with jobID parameters to get the log for that job.  Optionally return results as JSON or HTML|
|/createRepo| `targetHost` - Host to create the repository on<br/>`newRepoName` - Name of the new repository<br/>`configName` - Repository configuration to use<br/>`orgName` - Organization owning the new Repo<br/>`userPAT` - PAT of an org or site admin<br/>`username` - Username corresponding to the userPAT| Create a repository with the specified configuration|

              
## Responding to Pull Requests
              
repo-template can respond to specially formatted Pull Requests, creating repositories
based on configuration information in the Pull Request.  To configure Pull Request events:

1. Create a webhook in a repository pointing to the /pullrequest endpoint
2. Configure the webhook to respond to Pull Request events
3. Create a Pull Request
4. Include configuration parameters as well as the REPOSITORY_REQUEST token in the body of the PR, e.g.:
`REPOSITORY_REQUEST
{"targetHost":"github.com"
 ,"newRepoName":"AutoRepo"
 ,"configName":"default"
 ,"orgName":"bidnessforb"
 ,"username":"bryancross"}`
 
 <<image>>
 
 
5. When the PR is merged, the webhook will send the configuration parameters to the /pullrequest endpoint

Once the repository is created, repo-template will create an issue with a link to the log file for the 
creation process

<<image>>

## Responding to repository creation events

Repo-template can detect when users create repositories in an organization and intervene to apply repository configurations
to these new repositories.  This can be useful for enforcing branch and branch protection configuration, adding default teams, etc.

To enable repo-template to respond to repository creation events:

1. Create an organization webhook pointing to the `/repocreated` endpoint.
2. Configure the webhook to send Repository events.

Once the repository is created, repo-template will create an issue with a link to the log file for the 
modification process.

<<image>>

      
## Application Configuration

There are two application level configurations:
 - Server configuration: Default parameters for the repo-template server
 - Script configuration: a `.env` file for the command line shim scripts

### Server Configuration

Server configuration is stored in `./config/config.json`.  This file also serves
as the template for the job logging mechanism.  Only the `GitHubPAT`, `authType`,
and `userName` elements must be specified at this time.  

NOTE: The user specified must currently be a site admin

```json
  ,"adminGitHubPAT":"<xxxxxxxxxxxxxxxxxxxx>" //properly scoped PAT for an org owner or site admin. 
  ,"adminUserName":"" //Username corresponding to the adminGitHubPAT
  ,"authType":"oauth" //auth type.  Currently only oauth is supported
  ,"adminUsername":"admackbar" //user associated with the PAT
  ,"TemplateSourceHost":"octodemo.com" //Host for repository where repository configurations are stored
  ,"TemplateSourceRepo":"bryancross/repo-template" //Repository where repository configurations are stored
  ,"TemplateSourcePath":"config/repo_templates" //Path in repository where repository configurations are stored
  ,"repoDescriptionSuffix":"--Created by repo-template" //Suffix appended to repository descriptions
  ,"userAgent":"repo-template" //User agent to use in GitHubAPI REST calls
  ,"listenOnPort":3000 //Server port
  ,"callback": "" //Not implemented
  ,"jobsLimit":1000 //Maximum number of jobs to retain in memory
  ,"gitAPIDebug":false //Set debug flag for GitHubAPI
  ,"statusCallbackURL":"https://976986a5.ngrok.io/status" //URL to append to issues and comments pointing to the /status endpoint
```

### Command line configuration

The command line scripts require a `.env` file in the `./scripts` directory.  Required parameters include:

`USER_1_AUTH_TOKEN=<your properly scoped GitHub PAT>`
`REPO_TEMPLATE_URL=http://localhost:3000`

## Repository Configuration
    
Configuration data for new repositories are stored in JSON files in the `./config/repo_templates` directory.
    
There are 6 sections in the file:

 - Header: Info about the configuration, including it's name
 - Repository Attributes: Configuration information about the repository
 - Teams: Teams to be added as collaborators.
 - Branches: Branches to be created
 - Directories: Directories to be created in the new repository (not implemented)
 - Files: Files to be copied into the new repository (not implemented)
    
### Repository Configuration: Header
The header section identifies the configuration:
    
```json
  "configName":"default" // The name of the configuration to be specified when calling the server
  ,"configType":"repository" //The configuration type, currently only 'repository'
  ,"owningOrganization":"bryancross" //Owning organization
```    

### Repository Configuration: Repository Attributes

This section conforms to the GitHub API options specified in the Repository Create
API call.

For more information, see the [API Docs](https://developer.github.com/v3/repos/#create)
For more information on the Preview API options for merging pull requests, see the 
relevant [blog post](https://developer.github.com/changes/2016-09-26-pull-request-merge-api-update/)

```json
 "name":"Default"  // Repository name.  Replaced by newRepoName
  ,"description":"Default description" //A short description of the repository
  ,"homepage":"https://github.com" //A URL with more information about the repository
  ,"private":false // true to create a private repository, or false to create a public one
  ,"has_issues":true // true to enable issues for the repository, false to disable them
  ,"has_projects":true // true to enable projects for the repository, false to disable them
  ,"has_wiki":true // true to enable the wiki for this repository, false to disable it
  ,"auto_init":true //true to create an initial commit with an empty README.md
  ,"gitignore_template":"" //Desired language or platform .gitignore template to apply
  ,"license_template":"mit" //Desired LICENSE template to apply
  ,"allow_rebase_merge":true // true to allow rebase-merging pull-requests.
  ,"has_downloads":true // true to enable downloads
  ,"allow_squash_merge":true // true to allow squash-merging pull requests
  ,"allow_merge_commit":true // true to allow merging pull requests with a merge commit
  ,"team_id":-1 // ID of the team that will be granted access to this repository.  Currently not used.
```

### Repository Configuration: Teams

This section identifies teams to be added as collaborators to the new repository.

This section generally conforms to the GitHub API options specified in the Teams section
of the GitHub API.  The exception is that you can specify a team by name.

For more information, see the [API Docs](https://developer.github.com/v3/orgs/teams/#add-or-update-team-repository)

```json
"teams":
    [
      {
         "team":"Developers" //Team name
        ,"permission":"push" //Permissions
      }
      ,...
```

### Repository Configuration: Branches

This section identifies branches to be created in the new repository, as well as 
protections to be applied to those branches.  These conform to the Update branch
protection call in the GitHub API.

For more information, see the [API Docs](https://developer.github.com/v3/repos/branches/#update-branch-protection)

```json
"branches":
        [
          {
            "name":"master" //branch name
            ,"protection":
            {
              "required_status_checks": { //enable required status checks 
                "include_admins": true, //Include admins
                "strict": true, //Require branches to be up to date before merging
                "contexts": [
                  "continuous-integration/travis-ci" //Reqired status contexts
                ]
              },
              "required_pull_request_reviews": { //Require PR reviews
                "include_admins": false //Include admins in PR reviews
              },
              "enforce_admins": true, 
              "restrictions": { //Users and teams who can push to the branch
                "users": [
                  "Mario"
                ],
                "teams": [
                  "DevLeads"
                ]
              }
            }
          }
          ,...


```
## Logging
 - The server system log is written to `./log/repo-template.log`
 - Log info for each repository creation job is written to the `./log` directory
 with the jobID as the filename.
 
 