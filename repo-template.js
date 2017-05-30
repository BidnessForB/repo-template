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
var fs = require('fs');
var http = require('http');
var Job = require('./lib/job.js');
var HttpDispatcher = require('httpdispatcher');
var dispatcher     = new HttpDispatcher();
const PORT = 3000;
var differenceInMilliseconds = require('date-fns/difference_in_milliseconds'); //https://github.com/date-fns/date-fns
var jobs = [];
var suspended = false;
var globalConfig;

const ERR_CONFIG_NOT_MATCHING_TEMPLATE = 1;

logger.syslog("Server startup","Starting");

//load global config
try
{
    loadConfig();
}
catch(e)
{
    logger.syslog("Error loading server configuration: " + e.message, "Startup failed",e);
    process.exit(ERR_CONFIG_NOT_MATCHING_TEMPLATE);
}


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
};

function getTeamsForOrg(job)
{

    var proms = [];
    proms.push(job.github.orgs.getTeams({org: job.config.params.orgName}));
    Promise.all(proms)
        .then(function(teamArray)
        {
            if(teamArray.length > 0)
            {
                job.orgTeams = teamArray[0];
            }

            if(job.source != 'repocreated')
            {
                createRepo(job);
            }
            else
            {
                getBranchesForRepo(job);
            }
        }).catch(function(err){
        logger.log("No teams found.",job,"getTeamsForOrg",err);
    });

};

function createRepo(job)
{
    var repoConfig = arrayUtil.getArrayElementByKey(globalConfig.repoConfigs, job.config.params.configName, "configName");
    var options =
    {
        name: job.config.params.newRepoName
        ,description: repoConfig.repositoryAttributes.description + globalConfig.repoDescriptionSuffix
        ,homepage: repoConfig.repositoryAttributes.homepage
        ,private: repoConfig.repositoryAttributes.private
        ,has_issues: repoConfig.repositoryAttributes.has_issues
        ,has_projects: repoConfig.repositoryAttributes.has_projects
        ,has_wiki: repoConfig.repositoryAttributes.has_wiki
        ,auto_init: repoConfig.repositoryAttributes.auto_init
        ,gitignore_template: repoConfig.repositoryAttributes.gitignore_template
        ,license_template: repoConfig.repositoryAttributes.license_template
        ,allow_rebase_merge: repoConfig.repositoryAttributes.allow_rebase_merge
        ,has_downloads: repoConfig.repositoryAttributes.has_downloads
        ,allow_squash_merge: repoConfig.repositoryAttributes.allow_squash_merge
        ,allow_merge_commit: repoConfig.repositoryAttributes.allow_merge_commit
        ,org: job.config.params.orgName
    };

    job.github.repos.createForOrg(options)
        .then(function (newRepo)
        {   job.repository = newRepo;
            createIssue(job);
            getBranchesForRepo(job);
        }).catch(function(err){
            logger.endlog("Error creating repository: " + err.message, job, "Failed",err);
        });
};

function createIssue(job)
{

    job.github.issues.create({
        "owner":job.config.params.orgName
        ,"repo":job.config.params.newRepoName
        ,"title":"Your repository " + (job.source === 'repocreated' ? "modified" : "created") +" by repo-template"
        ,"body":"Your repo-template jobID: " + job.jobID + ".\r\n Check [here](" + globalConfig.statusCallbackURL + "?jobID=" + job.jobID + "&format=html) for status info."
    }).then(function(issue){
        logger.log("Issue " + issue.number + " created.",job,"createIssue");
    }).catch(function(err){
    logger.log("Could not create issue.",job,"createIssue",err);
    });
};

function createPRComment(pullRequest, job) {
    job.github.issues.createComment({
        "owner": pullRequest.repository.owner.login
        ,
        "repo": pullRequest.repository.name
        ,
        "number": pullRequest.number
        ,
        "body": "Your repo-template jobID: " + job.jobID + ".\r\n Check [here](" + globalConfig.statusCallbackURL + "?jobID=" + job.jobID + "&format=html) for status info."
    }).then(function (comment) {
        logger.log("PR comment " + comment.id + " created: " + issue.html_url, job, "createPRComent");
    }).catch(function (err) {
        logger.log("Error creating PR comment: " + err.message, job, "createPRComment", err);
    });
};




function getBranchesForRepo(job)
{
    job.github.gitdata.getReferences({
        "owner": job.config.params.orgName
        , "repo": job.config.params.newRepoName
    }).then(function(repoBranches)
    {
        job.repoBranches = repoBranches;
        var masterBranch = arrayUtil.getArrayElementByKey(repoBranches,"refs/heads/master","ref");
        if(masterBranch)
        {
            job.masterCommitSHA = masterBranch.sha;
        }
        if(job.config.params.templateRepo)
        {
            // copyRepo(job); //Runs async!
            logger.log("Beginning copy repo",job,"copyRepo");
            execSync("./script/repocopy.sh " + job.config.params.templateRepo + " " + job.repository.html_url + " ./job/" + job.jobID);
            logger.log("Finished copy repo",job,"copyRepo");
            //configureTeams(job);
        }
            configureTeams(job);

    }).catch(function (err)
    {
        if (err.code != 409 && err.message != "Git Repository is empty.")//conflict, empty repository )
        {
            logger.log("Modification of created repository " + job.repository.name + "failed. ", job, "repocreated", err);
            return;
        }
        else {
            try {
                execSync("./script/create-empty-commit.sh " + job.repository.html_url + " ./job/" + job.jobID + " '" + job.config.commitMsg + "'");
                getBranchesForRepo(job);
            }
            catch (e) {
                logger.log('Error creating empty commit: ' + e.message, job, "Failed", e);
                return;
            }
        }
    });
};

function getMasterSHA(job)
{

};

function createMasterBranch(job)
{

};

function serverFail(msg, job, status, err)
{
    logger.endlog(msg,job,status,err);
}

function copyRepo(job)
{
    try
    {
        //Currently only works with the simple config because it requires an empty repository
        //Can probably find command-line git fu to overcome this
        logger.log("Beginning copy repo",job,"copyRepo");
        execSync("./script/repocopy.sh " + job.config.params.templateRepo + " " + job.repository.html_url + " ./job/" + job.jobID);
        logger.log("Finished copy repo",job,"copyRepo");
        configureTeams(job);
    }
    catch(err)
    {
        serverFail("Error copying repository",job,"createRepoNew",err)
    }
};

function configureTeams(job)
{
    var proms = [];
    var team
    if(!job.repoConfig.teams)
    {
        createBranches(job);
        return;
    }
    for (var i = 0; i < job.repoConfig.teams.length; i++)
    {
        team = arrayUtil.getArrayElementByKey(job.orgTeams, job.repoConfig.teams[i].team, "name");
        if (team != null && arrayUtil.getArrayElementByKey(job.orgTeams, team.name, "name"))
        {
            logger.log("Adding team " + team.name,job,"configureTeams");
            proms.push(
            job.github.orgs.addTeamRepo({
                id: team.id
                , org: job.config.params.orgName
                , repo: job.repository.name
                , permission: job.repoConfig.teams[i].permission
            }));
        }
        if(proms.length > 0)
        {
            Promise.all(proms).then(function(result)
            {
                createBranches(job);
            });
        }
        else
        {
            createBranches(job);
        }
    }
}

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
        var masterBranch = arrayUtil.getArrayElementByKey(job.repoBranches,"refs/heads/master","ref");
        if(!arrayUtil.getArrayElementByKey(job.repoBranches, "refs/heads/" + branch.name,"ref"))
        {
            proms.push( proms.push(job.github.gitdata.createReference(
                {
                    owner: job.repository.owner.login
                    ,repo: job.repository.name
                    ,ref: 'refs/heads/' + job.repoConfig.branches[i].name
                    ,sha: masterBranch.object.sha
                })))
        }
    }
    Promise.all(proms).then(function(res)
    {
        configureBranchProtection(job);
    })
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
        logger.endlog("Repository creation complete",job,"Success");
    });


};

function createRepoNew(job)
{
    /* retrieveOrgTeams
       if(create)
        {createRepo}
       else
        {
            retrieveRepo
        }
        if(!masterExists)
        {
            emptyCommit
        }
        retrieveMasterSHA
        if(copy)
        {
            copyRepo
        }
        if(repo.teams)
        {
            for each team
            {
                applyTeam
            }
        }
        if(repo.branches)
        {
            for each branch
            {
                create
                if(branch.protections)
                {
                    applyProtections
                }
            }
        }
        complete

    */



    var teams = [];
    var branches = [];

    var options =
    {
        name: job.config.params.newRepoName
        ,
        description: job.repoConfig.repositoryAttributes.description + globalConfig.repoDescriptionSuffix
        ,
        homepage: job.repoConfig.repositoryAttributes.homepage
        ,
        private: job.repoConfig.repositoryAttributes.private
        ,
        has_issues: job.repoConfig.repositoryAttributes.has_issues
        ,
        has_projects: job.repoConfig.repositoryAttributes.has_projects
        ,
        has_wiki: job.repoConfig.repositoryAttributes.has_wiki
        ,
        auto_init: job.repoConfig.repositoryAttributes.auto_init
        ,
        gitignore_template: job.repoConfig.repositoryAttributes.gitignore_template
        ,
        license_template: job.repoConfig.repositoryAttributes.license_template
        ,
        allow_rebase_merge: job.repoConfig.repositoryAttributes.allow_rebase_merge
        ,
        has_downloads: job.repoConfig.repositoryAttributes.has_downloads
        ,
        allow_squash_merge: job.repoConfig.repositoryAttributes.allow_squash_merge
        ,
        allow_merge_commit: job.repoConfig.repositoryAttributes.allow_merge_commit
        ,org:job.config.params.orgName

    };
     var proms = [];
     proms.push(job.github.repos.createForOrg(options));

     Promise.all(proms)
        .then(function (res) {
           /*
            logger.log("Repository created. ID: " + res.id, job, "Success");
            job.repository = JSON.parse(JSON.stringify(res));
            if (job.config.params.templateRepo) {
                try
                {
                    (execSync("./script/repocopy.sh " + job.config.params.templateRepo + " " + job.repository.html_url + " ./job/" + job.jobID))
                }
                catch(err)
                {
                    logger.log("Error copying repository",job,"createRepoNew",err);
                }
            }
            */

        })
         .catch(function(error)
         {
             logger.log("Error creating repository",job,"createRepoNew",error);
         });
    return;
    proms = [];


    Promise.all(proms)
        .then(function(res)
        {

        })
        .catch(function(err)
        {
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
        }
});

     proms = [];
     proms.push(job.github.orgs.getTeams({org: job.config.params.orgName}));

     Promise.all(proms)
         .then(function(teamArray)
     {
         teams = teamArray;
     }).catch(function(err){
         logger.log("No teams found.",job,"createRepoNew",err);
     });

     if(job.repoConfig.teams)
     {
        proms = [];
        for(var i = 0; i < job.repoConfig.teams.length;i++)
        {
            var team = arrayUtil.getArrayElementByKey(teams,job.reposConfig.teams[i].name,"name");
            if(team)
            {
               proms.push( job.github.orgs.addTeamRepo({
                   id: team.id
                   , org: job.config.params.orgName
                   , repo: job.repository.name
                   , permission: job.repoConfig.teams[i].permission
               }));
            }
        }

        Promise.all(proms)
            .then(function(teamArray)
            {
               logger.log("Team configuration successful", job, "createRepoNew");
            })
            .catch(function(err)
            {
                logger.log("Error configuring teams",job,"createRepoNew",err);
            });
     }

     if(job.repoConfig.branches)
     {
        proms = [];
        proms.push(job.github.repos.getBranches({
             "owner":job.config.params.orgName
            ,"repo":job.repository.name
        }));

        Promise.all(proms)
            .then(function(branchArray){
                branches = branchArray;
            }) ;


         //Does master branch exist?  If not, do the empty commit trick
         var masterBranch = arrayUtil.getArrayElementByKey(branches,"master","name");
         if(!masterBranch)
         {
             try
             {
                 execSync("./script/create-empty-commit.sh " + job.repository.html_url + " ./job/" + job.jobID + " '" + job.config.commitMsg + "'");
             }
             catch(e)
             {
                 logger.log('Error creating empty commit: ' + e.message, job, "Failed",e);
                 return;
             }
         }
         proms = [];

         proms.push(job.github.repos.getBranch({
              "owner":job.repository.owner.login
             ,"repo":job.repository.name
             ,"branch":"master"
         }));

         Promise.all(proms).then(function(branchArray)
         {
             masterBranch = branchArray[0];
         });

         proms = [];
         for(var i = 0;i < job.repoConfig.branches.length;i++)
         {
            if(!arrayUtil.getArrayElementByKey(branches,job.repoConfig.branches[i],"name"))
            {
                proms.push(job.github.gitdata.createReference(
                    {
                        owner: job.repository.owner.login
                        ,
                        repo: job.repository.name
                        ,
                        ref: 'refs/heads/' + job.repoConfig.branches[i].name
                        ,
                        sha: masterBranch.masterCommitSHA
                    }));
            }
         }
     }
};

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

    //So wondering if the thing to do here isn't just to delete the created repository
    //and create a new one with the same name and owner following the specified
    //repository configuration?  Seems a lot easier than trying to figure out
    //whether to create a README etc., for an already extant repo.
    //But then, what would the point be of allowing org members to
    //create repos in the first place?

    var jobConfig = JSON.parse(JSON.stringify(globalConfig));
    jobConfig.params = {};
    jobConfig.params.username = globalConfig.adminUsername;
    jobConfig.params.targetHost = URL.parse(repoJSON.repository.html_url).hostname;
    jobConfig.params.configName = configName;
    jobConfig.params.userPAT = globalConfig.adminGitHubPAT;
    jobConfig.params.username = globalConfig.adminUsername;
    jobConfig.params.orgName = repoJSON.repository.owner.login;
    jobConfig.params.newRepoName = repoJSON.repository.name;
    var job = new Job(jobConfig);
    job.repoConfig = repoConfig;
    job.repository = repoJSON.repository;
    job.source = "repocreated";
    jobs.push(job);
    logger.syslog("Processing repository creation event request: " + job.config.params.configName + " jobID: " + job.jobID, "Repo Creation Event");
    createIssue(job);
    getTeamsForOrg(job);
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

dispatcher.onPost('/everything', function(req,res)
{
    var data = JSON.parse(req.body);
    console.log("foo");
});

dispatcher.onPost('/pullrequest', function(req,res)
{
    //Is this an attempt to merge to the configured watch branch?
    //Is the payload a properly formatted configuration request?

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
        logger.syslog("Skipping non-merge PR event: " + PR.action ,"pullrequest");
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

    jobConfig.params = params;
    var job = new Job(jobConfig);
    job.repoConfig = repoConfig;
    job.source="pullrequest";
    jobs.push(job);
    logger.syslog("Processing request: " + job.config.params.configName + " jobID: " + job.jobID,"Processing");
    createPRComment(PR, job);
    logger.log("Processing Pull Request repository creation event.",job,"pullrequest");
    getTeamsForOrg(job);
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
            logData = JSON.parse(fs.readFileSync('./log/' + jobID + '.json', "UTF-8"));
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
    res.writeHead(200, {'Content-Type':format === 'html' ? 'text/html' : 'text/plain'});
    res.end(format === 'html' ? logDataHTML : JSON.stringify(logData));
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
        httpStatus="Error reloading config: " + e.message;
        httpRetCode=500;
    }

    res.writeHead(httpRetCode, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({"msg":httpStatus}));

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
    res.end(JSON.stringify("{JobID: " + job.jobID + "}"));

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
    //createRepo(job);
    getTeamsForOrg(job);

});

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

    var newConfig = {};

    if(globalConfig && globalConfig.hasOwnProperty("repoConfigs"))
    {
        var origRepoConfigs = JSON.parse(JSON.stringify(globalConfig.repoConfigs));
    }

    logger.syslog("Loading system configuration","loadConfig");

    newConfig = JSON.parse(fs.readFileSync('./config/config.json'));
    verifyConfig(newConfig);

    globalConfig = JSON.parse(JSON.stringify(newConfig));
    if(origRepoConfigs)
    {
        globalConfig.repoConfigs = origRepoConfigs;
    }

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
};

function verifyConfig(config)
{
    //var configTemplate = require('./config/config-example.json');
    var configTemplate = JSON.parse(fs.readFileSync('./config/config-example.json'));
    var diffs = compareJSON(config, configTemplate);
    if(diffs)
    {
        logger.log("Configuration does not match specification",null,"Invalid Config");
        logger.log("Differences: " + JSON.stringify(diffs));
        throw new Error('Configuration/template mismatch: ' + JSON.stringify(diffs));
    }
};

function compareJSON(lhs, rhs)
{
    var diff = require('deep-diff');
    var diffs = diff(lhs,rhs);
    if (diffs && diffs.length > 0) {
        var diff = {};
        var output = {};
        output.diffs = [];
        var path = "";

        for (var i = 0; i < diffs.length; i++) {
            diff = diffs[i];
            if (diff.kind === 'N' || diff.kind === 'D') {
                if (diff.path) {
                    path = "";
                    for (var y = 0; y < diff.path.length; y++) {
                        path = path + diff.path[y] + "/";
                    }
                }
                output.diffs.push({
                    "type": (diff.kind === 'D' ? "Extra element" : "Missing element"),
                    "path": path
                });
            }
        }
        return output.diffs.length > 0 ? output : null;
    }
    return null;
};