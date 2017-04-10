/**
 * Created by bryancross on 12/27/16.
 *
 */

"use strict";
var logger = require('./lib/logger.js');
var arrayUtil = require('./lib/arrayUtil.js');
var execSync = require('child_process').execSync;
var GitHubClient = require("github"); //https://github.com/mikedeboer/node-github
var adminGitHub  = require("github"); //https://github.com/mikedeboer/node-github
var globalConfig = require("./config/config.json");
var fs = require('fs');
var http = require('http');
var Job = require('./lib/job.js');
var HttpDispatcher = require('httpdispatcher');
var dispatcher     = new HttpDispatcher();
const PORT = 3000;
var differenceInMilliseconds = require('date-fns/difference_in_milliseconds'); //https://github.com/date-fns/date-fns
var jobs = [];
var suspended = false;

logger.syslog("Server startup","Starting");

//load global config
loadConfig();

//Load repository configs
loadRepoConfigs();

//Create a server
var server = http.createServer(dispatchRequest);

//Startup the server

server.listen(globalConfig.listenOnPort == null ? PORT : globalConfig.listenOnPort, function () {
    //Callback when server is successfully listening
    logger.syslog("Server listening on: http://localhost: " + PORT, "Started");
});

//Dispatch request, send response
function dispatchRequest(request, response)
{
    try {
        //Dispatch
        dispatcher.dispatch(request, response);
    }
    catch (e) {
        logger.syslog(e)
    }
}

dispatcher.onPost('/repocreated', function(req,res) {
    logger.syslog("Repository event received", "repocreate");
    res.writeHead(202, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({"msg": "Repository creation received"}));
    if(suspended)
    {
        logger.syslog("Skipping repository event: server suspended","repocreate");
        return;
    }

    var repoJSON;
    try 
    {
        repoJSON = JSON.parse(req.body);
    }
    catch (e) {
        logger.syslog("Exception parsing repository create JSON", "repocreate", e);
        return;
    }

    if (repoJSON.action != 'created') {
        logger.syslog("Ignoring repository event action: " + repoJSON.action, "repocreate");
        return;
    }

    if (repoJSON.repository.description && repoJSON.repository.description.search(globalConfig.repoDescriptionSuffix)) {
        logger.syslog("Ignoring repository created by repo-template", "repocreate");
        return;
    }

    var URL = require('url');
    if (!URL.parse(req.url).query) {
        logger.syslog('No parameters found for repository creation event', 'repocreate');
        return;
    }

    var configName;

    try {
        configName = URL.parse(req.url).query.split('=')[1]
    }
    catch (e) {
        logger.syslog('Error parsing parameters from url: ' + req.url, "repocreate", e);
        return;
    }

    var repoConfig = arrayUtil.getArrayElementByKey(globalConfig.repoConfigs, configName, 'configName');

    if (repoConfig === null) {
        logger.syslog('Could not find repository configuration with name: ' + configName, "repocreate");
        return;
    }

    var jobConfig = JSON.parse(JSON.stringify(globalConfig));
    jobConfig.params = [];
    jobConfig.params.username = globalConfig.adminUsername;
    jobConfig.params.targetHost = URL.parse(repoJSON.repository.html_url).hostname;
    jobConfig.params.configName = configName;
    jobConfig.params.userPAT = globalConfig.adminGitHubPAT;
    jobConfig.params.username = globalConfig.adminUsername;
    jobConfig.params.orgName = repoJSON.repository.owner.login;
    var job = new Job(jobConfig);
    job.repoConfig = repoConfig;
    job.source = "repocreated";
    jobs.push(job);
    logger.syslog("Processing repository creation event request: " + job.config.params.configName + " jobID: " + job.jobID, "Repo Creation Event");
    job.github.repos.get({
        "owner": repoJSON.repository.owner.login
        , "repo": repoJSON.repository.name
    }).then(function (err, res) {
        job.repository = JSON.parse(JSON.stringify(err));
        job.github.gitdata.getReferences({
            "owner": repoJSON.repository.owner.login
            , "repo": repoJSON.repository.name
        }).then(function (err, res) {
            configureTeams(job);
        }).catch(function (err) {
                    var msgJSON = JSON.parse(err.message);
                    if (err.code != 409 && msgJSON.message != "Git Repository is empty.")//conflict, empty repository )
                    {
                        logger.log("Modification of created repository " + job.repository.name + "failed. ", job, "repocreated", err);
                        return;
                    }
                    else {
                        try
                        {
                            execSync("./script/create-empty-commit.sh " + job.repository.html_url + " ./job/" + job.jobID + " '" + job.config.commitMsg + "'");
                        }
                        catch(e)
                        {
                            logger.log('Error creating empty commit: ' + e.message, job, "Failed",e);
                            return;
                        }
                        configureTeams(job);
                        /*
                        execSync("./script/create-empty-commit.sh " + job.repository.html_url + " ./job/" + job.jobID + " '" + job.config.commitMsg + "'", function (error, stdout, stderr) {
                            if (error !== null) {
                                var jsErr = {"message": error};
                                logger.log('Error creating empty commit: ' + error, job, "repocreated", jsErr);
                                logger.log('Error creating empty commit: stdout: ' + stdout, job, "repocreated");
                                logger.log('Error creating empty commit: stderr: ' + stderr, job, "repocreated");
                                return;
                            }
                            else {
                                logger.log('Repository empty commit created', job, 'repocreated');
                                configureTeams(job);
                            }

                        });*/
                    }
                })
    });
    job.github.issues.create({
        "owner": repoJSON.repository.owner.login
        ,
        "repo": repoJSON.repository.name
        ,
        "title": "Your repository was created by repo-template"
        ,
        "body": "Your repo-template jobID: " + job.jobID + ".\r\n Check [here](" + globalConfig.statusCallbackURL + "?jobID=" + job.jobID + "&format=html) for status info."
    }).catch(function(err){
        console.log(err);
    });

});

dispatcher.onGet('/suspend', function(req,res)
{
    logger.syslog("Suspending server","Suspending");
    suspended = true;
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({"msg":"Server suspended"}));
});

dispatcher.onGet('/resume', function(req,res)
{
    logger.syslog("Resuming server","Resuming");
    suspended = false;
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({"msg":"Server resumed"}));
});

dispatcher.onPost('/pullrequest', function(req,res)
{

    res.writeHead(202, {'Content-Type': 'text/plain'});
    res.end("");
    if(suspended)
   {
       logger.syslog("PR event skipped: suspended","pullrequest");
       return;
   }
    try
    {
        var PR = JSON.parse(req.body);
    }
    catch(e)
    {
        logger.syslog("Error parsing Pull Request JSON","pullrequest",e);
        return;
    }

    if(!PR.pull_request || !PR.pull_request.merged || PR.pull_request.body.length < 18)
    {
        logger.syslog("Skipping non-merge PR event","pullrequest");
        return;
    }

    var PRBody = PR.pull_request.body.replace(/[\n\r]+/g,'')
    var params;

    var requestIndex = PRBody.indexOf("REPOSITORY_REQUEST") + 18;
    var requestEndIndex = PRBody.indexOf("}",requestIndex);

    if(requestIndex < 0)
    {
        logger.syslog("Ignoring non repository request PR", "pullrequest");
        return;
    }

    if(requestEndIndex < 0)
    {
        logger.syslog("Malformed pullrequest parameter block", "pullrequest");
        return;
    }

    try
    {
        params = JSON.parse(PRBody.substring(requestIndex,requestEndIndex + 1));
    }
    catch(e)
    {
        logger.syslog("Error parsing Pull Request JSON: " + e.message, "pullrequest",e);
        return;
    }

    params.userPAT = globalConfig.adminGitHubPAT;

    if (!params.targetHost || !params.newRepoName || !params.configName || !params.orgName || !params.userPAT || !params.username)
    {
        logger.syslog("PR event missing parameters: " + JSON.stringify(params),"pullrequest");
        return;
    }

    var repoConfig = arrayUtil.getArrayElementByKey(globalConfig.repoConfigs,params.configName,'configName');

    if(repoConfig == null)
    {
        logger.syslog("No config found for name: " + params.configName,"pullrequest");
        return;
    }

    var jobConfig = JSON.parse(JSON.stringify(globalConfig));
    delete jobConfig.params;
    jobConfig.params = params;
    var job = new Job(jobConfig);
    job.repoConfig = repoConfig;
    job.source="pullrequest";
    jobs.push(job);
    logger.syslog("Processing request: " + job.config.params.configName + " jobID: " + job.jobID,"Processing");
    job.github.issues.createComment({
         "owner":PR.repository.owner.login
        ,"repo":PR.repository.name
        ,"number":PR.number
        ,"body":"Your repo-template jobID: " + job.jobID + ".\r\n Check [here](" + globalConfig.statusCallbackURL + "?jobID=" + job.jobID + "&format=html) for status info."
    }).then(function (req,res){
        job.PRCommentID = req.id;
        logger.log("Processing Pull Request repository creation event.",job,"pullrequest");
        createRepo(job);
    });

});

dispatcher.onGet('/status', function(req,res)
{

    logger.syslog("Status request received","Status");

    var URL = require('url');
    var jobID;
    var format = 'json';


    if(!URL.parse(req.url).query)
    {
        logger.syslog("Received status request","Status");
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({"serverState":suspended ? "suspended" : "active"}));
        return;
    }

    try
    {
        jobID = URL.parse(req.url).query.split('=')[1].split('&')[0];
    }
    catch(e)
    {
        logger.syslog('Error parsing parameters from url: ' + req.url,"Status");
        return;
    }

    logger.syslog("Received status request for job with ID: " + jobID,"Status");
    try
    {
        var formatParam = URL.parse(req.url).query.split('=')[2];
        if (formatParam === 'html')
        {
            format = 'html';
        }
    }
    catch(e)
    {
        logger.syslog("No format parameter specified.  Returning JSON","Status");
    }

    ///Search the array of jobs in memory
    //var id = arrayUtil.findValueInArray(jobs, jobID, "jobID");
    var curJob = arrayUtil.getArrayElementByKey(jobs,jobID,"jobID");
    var logData;
    var logDataHTML;
    if(curJob)
    {
        logData = curJob.cleanse();
        logDataHTML = curJob.getHTML();
    }
    else
    {
        //If we're still here the job is finished and the job object deleted from the global array
        //So let's see if there's info in the log...
        try
        {
            logData = JSON.parse(fs.readFileSync('./log/' + jobID + '.log', "UTF-8"));
            logDataHTML = "<!DOCTYPE html><html><body><h2>Repository Creation Job: " + logData.jobID + " Status: " + logData.status + " </h2><br/><pre>" + JSON.stringify(logData,null,4) + "</pre></body></html>";
        }
        catch(err)
        {
            //no file found
            if(err.errno === -2)
            {
                res.writeHead(404,{'Content-Type':'application/json'})
                res.end(JSON.stringify({"msg":"No job data found for job ID: " + jobID}));
            }
            //something else went wrong
            else
            {
                res.writeHead(500,{'Content-Type':'application/json'});
                res.end(JSON.stringify({"msg":"Error retrieving log file for job ID: " + jobID + " " + err.message}));
            }
        }
    }
    res.writeHead(200, {'Content-Type': format === 'html' ? 'text/html' : 'text/plain'});
    res.end(format === 'html' ? logDataHTML : logData);
});

dispatcher.onGet('/stop', function(req,res)
{
    logger.syslog("Received stop signal.", "Stopping");
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({"msg":"Server shutting down"}));
    process.exit(0);
});

dispatcher.onGet('/reloadConfig', function(req,res)
{
    logger.syslog("Reloading configuration","Reload");
    var httpRetCode  =200;
    var httpStatus;
    try
    {
        loadConfig();
        logger.syslog("Server configuration reloaded","reloadConfig");
        httpStatus="Configuration reloaded";
    }
    catch(e)
    {
        logger.syslog("Error reloading configuration: " + e.message,"reloadConfig",e);
        httpStatus="Error reloading config.  Server will exit";
        httpRetCode=500;

    }
    res.writeHead(httpRetCode, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({"msg":httpStatus}));
    if(httpRetCode === 500)
    {
        process.exit(0);
    }
});

dispatcher.onGet('/reloadRepoConfigs', function(req,res)
{
    logger.syslog("Received request to reload repository configurations", "Running");
    try
    {
        loadRepoConfigs();
    }
    catch(e)
    {
        logger.syslog("Error loading repository configurations. " + e.message);
        res.writeHead(400, {'Content-Type': 'text/plain'});
        res.end(JSON.stringify("Error loading repository configurations. " + e.message));
        return;
    }

    logger.syslog(globalConfig.repoConfigs.length + " configurations loaded.");
    res.writeHead(201, {'Content-Type': 'text/plain'});
    res.end(globalConfig.repoConfigs.length + " configurations loaded.");

});

//handle a call to /status.  Find the job in jobs, or if it isn't in the array find the log directory, and
//return the job log data.
dispatcher.onPost('/createRepo', function (req, res)
{
    if(suspended)
    {
        logger.syslog("Server is suspended. Ignoring request","Suspended");
        res.writeHead(400, {'Content-Type': 'text/plain'});
        res.end(JSON.stringify("Server is suspended.  Make a call to /resume"));
        return;
    }
    //var job = new Job(globalConfig);
    var job = new Job();
    res.writeHead(202, {'Content-Type': 'application/json'});
    res.end(JSON.stringify("{JobID: " + job.jobID));

    try {
        var params = JSON.parse(req.body);
        if (!params.targetHost || !params.newRepoName || !params.configName || !params.orgName || !params.userPAT || !params.username) {
            logger.syslog("Invalid request", "Error");
            res.writeHead(400, {'Content-Type': 'text/plain'});
            res.end("Invalid request, missing parameter");
            return;
        }
    }
    catch(e)
    {
        logger.syslog("Exception processing request: " + e.message,"Error");
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify("Invalid request: " + e.message));
        return;
    }

    var repoConfig = arrayUtil.getArrayElementByKey(globalConfig.repoConfigs,params.configName,"configName");
    if(repoConfig == null)
    {
        logger.syslog("Requested configuration not found: " + job.config.params.configName, "Error");
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify("Invalid request.  Requested configuration not found: " + job.config.params.configName));
        return;
    }

    var jobConfig = JSON.parse(JSON.stringify(globalConfig));
    delete jobConfig.params;
    jobConfig.params = params;
    job.config(jobConfig);
    job.repoConfig = repoConfig;
    job.source="request";
    jobs.push(job);
    logger.syslog("Processing request: " + job.config.params.configName + " jobID: " + job.jobID,"Processing");
    createRepo(job);
});

function createRepo(job)
{
    var repoConfig = job.config.repoConfigs[arrayUtil.findValueInArray(job.config.repoConfigs, job.config.params.configName, "configName")];
    logger.log("Found config: " + repoConfig.configName,job, "Creating repo");
    var options =
                {
                    name: job.config.params.newRepoName
                    ,
                    description: repoConfig.repositoryAttributes.description + globalConfig.repoDescriptionSuffix
                    ,
                    homepage: repoConfig.repositoryAttributes.homepage
                    ,
                    private: repoConfig.repositoryAttributes.private
                    ,
                    has_issues: repoConfig.repositoryAttributes.has_issues
                    ,
                    has_projects: repoConfig.repositoryAttributes.has_projects
                    ,
                    has_wiki: repoConfig.repositoryAttributes.has_wiki
                    ,
                    auto_init: repoConfig.repositoryAttributes.auto_init
                    ,
                    gitignore_template: repoConfig.repositoryAttributes.gitignore_template
                    ,
                    license_template: repoConfig.repositoryAttributes.license_template
                    ,
                    allow_rebase_merge: repoConfig.repositoryAttributes.allow_rebase_merge
                    ,
                    has_downloads: repoConfig.repositoryAttributes.has_downloads
                    ,
                    allow_squash_merge: repoConfig.repositoryAttributes.allow_squash_merge
                    ,
                    allow_merge_commit: repoConfig.repositoryAttributes.allow_merge_commit

                };
    /*
                if(!job.config.params.orgName) {
        job.github.repos.create(options)
            .then(function (err, res) {
                logger.log("Repository created. ID: " + err.id,job,"Success");
                job.repository = JSON.parse(JSON.stringify(err));
                configureTeams(job,repoConfig);
            }).catch(function (err) {
            logger.endlog("Error creating repository: " + err.message, job, "Failed", err);
            return;
        });
    }

    else
    {
    */
        options.org = job.config.params.orgName;
        job.github.repos.createForOrg(options)
            .then(function (err, res) {
                logger.log("Repository created. ID: " + err.id,job,"Success");
                job.repository = JSON.parse(JSON.stringify(err));
                if(job.config.params.templateRepo)
                {
                    copyRepo(job);
                }
            }).then(function (err,res)
            {
                configureTeams(job, repoConfig);
            }).then(function (err,req) {
            logger.log("Creating issue in new repository", job, "configBranches");
            job.github.issues.create({
                "owner": job.repository.owner.login
                ,
                "repo": job.repository.name
                ,
                "title": "Repository " + (job.source === 'repocreated' ? "modified " : "created ") + "by repo-template."
                ,
                "body": "Review the [log](" + globalConfig.statusCallbackURL + "?jobID=" + job.jobID + "&format=html)"
            })
        }).catch(function (err) {
                logger.endlog("Error creating repository: " + err.message, job, "Failed", err);
                return;
            });
    //}
};

function configureTeams(job) {
    if (job.config.params.orgName && job.repoConfig.teams) {
        logger.log("Configuring teams",job,"configureTeams");
        var team;
        job.github.orgs.getTeams({org: job.config.params.orgName})
            .then(function (err, res) {
                for (var i = 0; i < job.repoConfig.teams.length; i++) {
                    team = arrayUtil.getArrayElementByKey(err, job.repoConfig.teams[i].team, "name");
                    if (team != null) {
                        logger.log("Adding team " + team.name,job,"configureTeams");
                        job.github.orgs.addTeamRepo({
                            id: team.id
                            , org: job.config.params.orgName
                            , repo: job.repository.name
                            , permission: job.repoConfig.teams[i].permission
                        })
                    }

                }
            }).then(function (err, res) {
            if (job.repoConfig.branches)
            {
               configBranches(job);
            }
        }).catch(function (err)
            {
               logger.endlog("Error creating branches", job, "Failed",err);
               return;
            });
    }
};

function configBranches(job)
{
    //Create a ref with the SHA of the HEAD commit to branch from
    //So first, get the ref

    logger.log("Configuring branches",job,"configBranches");
    job.github.repos.getBranch({
        owner: job.repository.owner.login,
        repo: job.repository.name,
        branch: 'master'
    }).then(function (err, res)
        {
            job.commitSHA = err.commit.sha;
            logger.log("Master branch found.  HEAD commit SHA: " + job.commitSHA,job,"configBranches");
                for(var i = 0; i < job.repoConfig.branches.length; i++) {
                    if (job.repoConfig.branches[i].name != 'master') {
                        logger.log("Creating branch " + job.repoConfig.branches[i].name, job, "configBranches");
                        job.github.gitdata.createReference(
                            {
                                owner: job.repository.owner.login
                                ,
                                repo: job.repository.name
                                ,
                                ref: 'refs/heads/' + job.repoConfig.branches[i].name
                                ,
                                sha: job.commitSHA
                            }
                        ).then(function (err, res) {
                            configBranchProtection(job, err.ref.split('/').pop());
                        }).catch(function(err)
                        {
                            //"message":"Branch not found" when master doesn't exist
                            logger.endlog("Error " + job.source === "repocreated" ? "modifying" : "creating" + " repository: " + err.message,job,"Failed");
                        })
                    }
                    else {
                        configBranchProtection(job, job.repoConfig.branches[i].name);
                    }
                }
/*
                            //var index = arrayUtil.findValueInArray(job.repoConfig.branches,err.ref.split('/').pop(),"name");
                            var branch = arrayUtil.getArrayElementByKey(job.repoConfig.branches, err.ref.split('/').pop(),"name");
                            //var branch = job.repoConfig.branches[index];

                            if (branch.protection) {
                                var params = {
                                    "owner": job.repository.owner.login
                                    , "repo": job.repository.name
                                    , "branch": branch.name
                                }
                                if (branch.protection.required_status_checks) {
                                    params.required_status_checks = JSON.parse(JSON.stringify(branch.protection.required_status_checks));
                                }
                                if (branch.protection.required_pull_request_reviews) {
                                    params.required_pull_request_reviews = JSON.parse(JSON.stringify(branch.protection.required_pull_request_reviews));
                                }
                                if (branch.protection.restrictions) {
                                    params.restrictions = JSON.parse(JSON.stringify(branch.protection.restrictions));
                                }
                                logger.log("Updating branch protection for branch: " + branch.name,job,"configBranches");
                                job.github.repos.updateBranchProtection(params).then(function(err,res){
                                    logger.syslog("Repository " + job.source === 'repocreated' ? "modification" : "creation" + " complete: " + job.repository.name,'configBranches');
                                    logger.endlog("Repository " + job.source === 'repocreated' ? "modification" : "creation" + " complete: " + job.repository.name,job,"Success");
                                })
                            }}).catch(function(err)
                        {
                            //"message":"Branch not found" when master doesn't exist
                            logger.endlog("Error " + job.source === "repocreated" ? "modifying" : "creating" + " repository: " + err.message,job,"Failed");
                        })
                    //}
                }
*/
            });
};

function configBranchProtection(job, branch)
{
    //var index = arrayUtil.findValueInArray(job.repoConfig.branches,err.ref.split('/').pop(),"name");
    var branchConfig = arrayUtil.getArrayElementByKey(job.repoConfig.branches, branch,"name");
    //var branch = job.repoConfig.branches[index];

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
        logger.log("Updating branch protection for branch: " + branchConfig.name,job,"configBranches");
        job.github.repos.updateBranchProtection(params).then(function(err,res){
            logger.log("Branch protection applied for " + branchConfig.name);
            branchConfig.status="complete";
            updateStatus(job);
        }).catch(function(err){
            logger.log("Error applying branch protection for " + branchConfig.name,job,'configBranchProtection',err);
            branchConfig.status="error";
            updateStatus(job);
        });
    }
};

function updateStatus(job)
{
    var countDone = 0;

    for(var i=0;i < job.repoConfig.branches.length;i++)
    {
        var branchConfig = job.repoConfig.branches[i];
        if(branchConfig.status)
        {
            countDone++;
        }
    }

    if(countDone === job.repoConfig.branches.length)
    {
        logger.endlog("Repository " + job.repository.name + " " + (job.source === "repocreated" ? "modification" : "creation" )+ " complete.",job,"Success");
    }




}


function loadRepoConfigs() {
    var configs = [];
    var config;
    logger.syslog("Loading repository configurations", "loadRepoConfigs");

    delete globalConfig["repoConfigs"];
    globalConfig.repoConfigs = [];
    logger.syslog("Loading repository configurations", "loadRepoConfigs");

    if (globalConfig.TemplateSource === 'repository') {
        var repoDir = adminGitHub.repos.getContent({
            "owner": globalConfig.TemplateSourceRepo.split('/')[0]
            , "repo": globalConfig.TemplateSourceRepo.split('/').pop()
            , "path": globalConfig.TemplateSourcePath
            , "ref": globalConfig.TemplateSourceBranch
        }).catch(function (err) {
            logger.syslog("Error retrieving repository configurations: " + err.message, "Failed", err);
            process.exit(0);
        });


        var file = repoDir.then(function (err, res) {
            for (var i = 0; i < err.length; i++) {
                logger.syslog("Loading config: " + err[i].path.split('/').pop(), "loadRepoConfigs");
                adminGitHub.repos.getContent({
                    "owner": globalConfig.TemplateSourceRepo.split('/')[0]
                    , "repo": globalConfig.TemplateSourceRepo.split('/').pop()
                    , "path": err[i].path
                    , "ref": globalConfig.TemplateSourceBranch
                }).then(function (err, res) {
                    var B64 = require('js-base64/base64.js').Base64;
                    var config = JSON.parse(B64.decode(err.content));
                    globalConfig.repoConfigs.push(config);
                    logger.syslog("Loaded config: " + config.configName, "loadRepoConfigs");
                }).catch(function (err) {
                    logger.syslog("Error loading repository configurations: " + err.message, "Failed");
                    process.exit(0);
                });
            }
        });
    }
    else
    {
        try
        {
            var files = fs.readdirSync('./config/repo_templates');
        }
        catch(e)
        {
            logger.syslog("Error reloading repository configurations","loadRepoConfigs",e);
            return;
        }

        for(var i = 0; i < files.length; i++)
        {
            try
            {
                var configData = fs.readFileSync("./config/repo_templates/" + files[i]);
                configData = JSON.parse(configData);
                globalConfig.repoConfigs.push(configData);
                logger.syslog("Loaded repository configuration: " + configData.configName,"loadRepoConfigs");
            }
            catch(e)
            {
                logger.syslog("Error parsing configuration: " + files[i],"loadRepoConfigs",e);
            }
        }
    }

};

function loadConfig()
{

    if(globalConfig.repoConfigs)
    {
        var origRepoConfigs = JSON.parse(JSON.stringify(globalConfig.repoConfigs));
    }
    globalConfig = {};
    logger.syslog("Loading system configuration","loadConfig");
    globalConfig = JSON.parse(fs.readFileSync('./config/config.json'));
    globalConfig.repoConfigs = origRepoConfigs;
    adminGitHub = new GitHubClient({
        debug: globalConfig.githubAPIDebug
        ,pathPrefix: globalConfig.TemplateSourceHost !== "github.com" ? "/api/v3" : ""
        ,host: globalConfig.TemplateSourceHost === 'github.com' ? 'api.github.com' : globalConfig.TemplateSourceHost
        ,protocol: "https"
        ,headers: {"user-agent":"repo-template"}
    });

    var adminAuth = {
        type: globalConfig.authType
        , token: globalConfig.adminGitHubPAT
        , username: globalConfig.adminUsername
    };
//authenticate using configured credentials
    adminGitHub.authenticate(adminAuth);

    //GitHub Enterprise uses /api/v3 as a prefix to REST calls, while GitHub.com does not.
    globalConfig.pathPrefix = (globalConfig.targetHost !== "github.com") ? "/api/v3" : "";

//If we're going to GitHub, prepend the host with 'api', otherwise leave it be
    globalConfig.targetHost = (globalConfig.targetHost === "github.com") ? "api.github.com" : globalConfig.targetHost;
    logger.syslog("Server configuration reloaded","loadConfig");
}