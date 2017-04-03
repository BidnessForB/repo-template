# repo-template

Utility server which accepts requests to create new repositories based on 
configuration files.  

### Getting Started

1. Clone the repository
2. Run ./script/bootstrap
3. Edit config.json and add your properly scoped GitHub PAT.  
4. Run ./script/repo_template.sh to start the server
    `./script/repo_template.sh start`
5. Run ./script/repo-template.sh with appropriate arguments to create a new 
   repository
    `./script/repo_template.sh create-repository create-repo targetHost newRepoName repoConfigName <ownerName | orgName>`
    
    