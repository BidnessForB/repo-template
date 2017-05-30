/**
 * Created by bryancross on 12/27/16.
 *
 */

"use strict";
var fs = require('fs');
var http = require('http');
var HttpDispatcher = require('httpdispatcher');
var dispatcher     = new HttpDispatcher();
var globalConfig = require('./config/config-lite.json');
var GitHubClient = require("github"); //https://github.com/mikedeboer/node-github
var HashMap = require('hashmap');
const PORT = 3000;

//Load repository configs
loadRepoConfigs();

//Create a server
var server = http.createServer(dispatchRequest);

//Startup the server
server.listen(globalConfig.listenOnPort == null ? PORT : globalConfig.listenOnPort, function () {
console.log("Server listening on: http://localhost: " + PORT);
});

//Dispatch request, send response
function dispatchRequest(request, response)
{
    try {
        //Dispatch
        dispatcher.dispatch(request, response);
    }
    catch (e) {
        console.log(e);
    }
};

function createRepo(job)
{
    
    var options =
    {
        name: job.params.newRepoName
        ,description: job.repoConfig.repositoryAttributes.description + " -- created by repo-template"
        ,homepage: job.repoConfig.repositoryAttributes.homepage
        ,private: job.repoConfig.repositoryAttributes.private
        ,has_issues: job.repoConfig.repositoryAttributes.has_issues
        ,has_projects: job.repoConfig.repositoryAttributes.has_projects
        ,has_wiki: job.repoConfig.repositoryAttributes.has_wiki
        ,auto_init: true //job.repoConfig.repositoryAttributes.auto_init.  Without an initial commit you can't create any additional branches.
        ,gitignore_template: job.repoConfig.repositoryAttributes.gitignore_template
        ,license_template: job.repoConfig.repositoryAttributes.license_template
        ,allow_rebase_merge: job.repoConfig.repositoryAttributes.allow_rebase_merge
        ,has_downloads: job.repoConfig.repositoryAttributes.has_downloads
        ,allow_squash_merge: job.repoConfig.repositoryAttributes.allow_squash_merge
        ,allow_merge_commit: job.repoConfig.repositoryAttributes.allow_merge_commit
        ,org: job.params.orgName
    };

    job.github.repos.createForOrg(options)
        .then(function (newRepo)
        {   job.repository = newRepo;
            getBranchesForRepo(job);
        }).catch(function(err){
            console.log("Error creating repository: " + err.message);
        });
};

function getBranchesForRepo(job)
{
    var masterBranch = null;
    job.repoBranches = new HashMap();
    job.github.gitdata.getReferences({
        "owner": job.params.orgName
        , "repo": job.params.newRepoName
    }).then(function(repoBranches)
    {
        for(var i = 0;i < repoBranches.length;i++)
        {
            job.repoBranches.set(repoBranches[i].ref.split('/').pop(), repoBranches[i]);
        };
    if(!job.repoConfig.teams)
    {
        createBranches(job);
    }
    else
    {
        configureTeams(job);
    }
    }).catch(function (err)
    {
        console.log("Error retrieving branches for repo: " + err.message);
    });
};

function configureTeams(job)
{
    var proms = [];
    var team;
    for (var i = 0; i < job.repoConfig.teams.length; i++)
    {
                proms.push(
                    job.github.orgs.addTeamRepo({
                        id: job.orgTeams.get(job.repoConfig.teams[i].team).id
                        , org: job.params.orgName
                        , repo: job.repository.name
                        , permission: job.repoConfig.teams[i].permission
                    }));
    }
        Promise.all(proms).then(function(result)
        {
            createBranches(job);
        }).catch(function(err)
        {
            console.log("Error configuring teams: " + err.message);
        });
};

function createBranches(job)
{
    var proms = [];
    if(!job.repoConfig.branches)
    {
        return;
    }
    for(var i = 0; i < job.repoConfig.branches.length;i++)
    {
        var branch = job.repoConfig.branches[i];
        if(branch.name != 'master')
        {
            proms.push(job.github.gitdata.createReference(
                {
                    owner: job.repository.owner.login
                    ,repo: job.repository.name
                    ,ref: 'refs/heads/' + job.repoConfig.branches[i].name
                    ,sha: job.repoBranches.get('master').object.sha
                }));
        }
    }
    Promise.all(proms).then(function(res)
    {
        configureBranchProtection(job);
    }).catch(function(err){
        console.log("Error creating branches: " + err.message);
    });
};

function configureBranchProtection(job)
{
    var proms = [];
    var branchConfig;
    for(var i = 0; i < job.repoConfig.branches.length;i++) {
        branchConfig = job.repoConfig.branches[i];
        if (branchConfig.protection) {
            var params = {
                "owner": job.repository.owner.login
                , "repo": job.repository.name
                , "branch": branchConfig.name
            }
            if (branchConfig.protection.required_status_checks) {
                params.required_status_checks = JSON.parse(JSON.stringify(branchConfig.protection.required_status_checks));
            }
            if (branchConfig.protection.required_pull_request_reviews) {
                params.required_pull_request_reviews = JSON.parse(JSON.stringify(branchConfig.protection.required_pull_request_reviews));
            }
            if (branchConfig.protection.restrictions) {
                params.restrictions = JSON.parse(JSON.stringify(branchConfig.protection.restrictions));
            }
            proms.push(job.github.repos.updateBranchProtection(params));
        }
    }
    Promise.all(proms).then(function(result)
    {
        console.log("Repository creation complete");
    });
};

//handle a call to /status.  Find the job in jobs, or if it isn't in the array find the log directory, and
//return the job log data.
dispatcher.onPost('/createRepo', function (req, res)
{
    var job = {};
    res.writeHead(202, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({"msg":"Repo create request received"}));

    try
    {
        var params = JSON.parse(req.body);
    }
    catch(e)
    {
        console.log("Exception processing request: " + e.message);
        return;
    }

    //var repoConfig = arrayUtil.getArrayElementByKey(globalConfig.repoConfigs,params.configName,"configName");

    var repoConfig = globalConfig.repoConfigs.get(params.configName);
    if(!repoConfig)
    {
        console.log("Requested configuration not found: " + job.params.configName);
        return;
    }

    //job.config = JSON.parse(JSON.stringify(globalConfig));
    job.params = params;
    job.repoConfig = repoConfig;
    job.source="request";

    var github = new GitHubClient({
        debug: globalConfig.githubAPIDebug
        ,pathPrefix: job.params.targetHost !== "github.com" ? "/api/v3" : ""
        ,host: job.params.targetHost === 'github.com' ? 'api.github.com' : job.params.targetHost
        ,protocol: "https"
        ,headers: {"user-agent":"repo-template"}
    });

    var auth = {
        type: "oauth"
        , token: job.params.userPAT
        , username: job.params.username
    };
//authenticate using configured credentials
    github.authenticate(auth);
    job.github = github;
    getTeamsForOrg(job);
});

function getTeamsForOrg(job)
{
    var proms = [];
    job.orgTeams = new HashMap();
    proms.push(job.github.orgs.getTeams({org: job.params.orgName}));
    Promise.all(proms)
        .then(function(teams)
        {
            teams[0].forEach(function(team)
            {
                job.orgTeams.set(team.name,team);
            })
            createRepo(job);
        }).catch(function(err){
        console.log("No teams found for org: " + job.params.orgName);
    });
};

function loadRepoConfigs() {
    var configs = [];
    var config;

    globalConfig.repoConfigs = new HashMap();
    try
    {
        var files = fs.readdirSync('./config/repo_templates');
    }
    catch(e)
    {
        console.log("Error reloading repository configurations: " + e.message);
        return;
    }
        for(var i = 0; i < files.length; i++)
        {
            try
            {
                var configData = JSON.parse(fs.readFileSync("./config/repo_templates/" + files[i]));
                globalConfig.repoConfigs.set(configData.configName, configData);
                console.log("Loaded repository configuration: " + configData.configName);
            }
            catch(e)
            {
                console.log("Error parsing configuration: " + files[i] + " " + e.message);
            }
        }
};
