/**
 * Created by bryancross on 12/27/16.
 *
 */

"use strict";
var URL = require('url');
var logger = require('./lib/logger.js');
var arrayUtil = require('./lib/arrayUtil.js');

//Native NodeJS url package keeps coming up undefined...
var URL = require('url');
var b64 = require('js-base64').Base64;
var crypto = require('crypto');
var exec = require('child_process').exec;
var GitHubClient = require("github"); //https://github.com/mikedeboer/node-github
var globalConfig = require("./config/config.json");
var fs = require('fs');
var http = require('http');
var Job = require('./lib/job.js');

var HttpDispatcher = require('httpdispatcher');
var dispatcher     = new HttpDispatcher();
const PORT = 3000;
var parse = require('date-fns/parse');  //https://github.com/date-fns/date-fns
var format = require('date-fns/format');  //https://github.com/date-fns/date-fns
var differenceInMilliseconds = require('date-fns/difference_in_milliseconds'); //https://github.com/date-fns/date-fns
var jobs = [];
var suspended = false;


logger.syslog("Server startup","Starting");
loadRepoConfigs();


//GitHub Enterprise uses /api/v3 as a prefix to REST calls, while GitHub.com does not.
globalConfig.pathPrefix = (globalConfig.targetHost !== "github.com") ? "/api/v3" : "";

//If we're going to GitHub, prepend the host with 'api', otherwise leave it be
globalConfig.targetHost = (globalConfig.targetHost === "github.com") ? "api.github.com" : globalConfig.targetHost;

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

dispatcher.onGet('/suspend', function(req,res)
{
    logger.syslog("Suspending server","Suspending");
    suspended = true;
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end("Server suspended");
});

dispatcher.onGet('/resume', function(req,res)
{
    logger.syslog("Resuming server","Resuming");
    suspended = false;
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end("Server resumed");

});

dispatcher.onPost('/status', function(req,res)
{

    var statusJSON;

    if(!req.body)
    {
        statusJSON = {"serverState":suspended ? "suspended" : "active"}
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end(JSON.stringify(statusJSON));
        return;
    }

    var jobID = JSON.parse(req.body).jobID;

    ///Search the array of jobs in memory
    var id = arrayUtil.findValueInArray(jobs, jobID, "jobID");
    if (id || id === 0) {
        var status = JSON.parse(JSON.stringify(jobs[id]));

        //Delete the github object, since it is 1000s of lines long
        //Redact the PAT as well.
        try
        {
            status.config.GitHubPAT = "<redacted>";
            delete status["github"];

        }
        catch(e)
        {
            logger.syslog("No github object in job: " + id,"Error");
        }

        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end(JSON.stringify(status));
        return;
    }
    //If we're still here the job is finished and the job object deleted from the global array
    //So let's see if there's info in the log...
    try
    {
        var logData = fs.readFileSync('./log/' + jobID + '.json', "UTF-8");
        logData = JSON.stringify(logData);
        res.end(logData);
    }
    catch(err)
    {
        //no file found
        if(err.errno === -2)
        {
            res.end("No job data found for job ID: " + jobID);
        }
        //something else went wrong
        else
        {
            res.end('Error retrieving log file for job ID: ' + jobID + " " + err.message);
        }
    }

});


dispatcher.onGet('/stop', function(req,res)
{
    logger.syslog("Received stop signal.", "Stopping");
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end("Server shutting down");
    process.exit(0);
});

dispatcher.onGet('/loadRepoConfigs', function(req,res)
{
    logger.syslog("Received request to reload repository configurations", "Running");
    try
    {
        loadRepoConfigs();
    }
    catch(e)
    {
        res.writeHead(400, {'Content-Type': 'text/plain'});
        res.end(JSON.stringify("Error loading repository configurations. " + e.message));
        return;
    }

    res.writeHead(200, {'Content-Type': 'text/plain'});
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

    var params = JSON.parse(req.body);

    try
    {
        if (!params.targetHost || !params.newRepoName || !params.configName || !params.ownerName)
        {
            logger.syslog("Invalid request", "Error");
            res.writeHead(400, {'Content-Type': 'text/plain'});
            res.end(JSON.stringify("Invalid request, missing parameter"));
            return;
        }
        var job = new Job(globalConfig,params);
    }
    catch(e)
    {
        logger.syslog("Exception processing request: " + e.message,"Error");
        res.writeHead(400, {'Content-Type': 'text/plain'});
        res.end(JSON.stringify("Invalid request: " + e.message));
        return;
    }

    if(arrayUtil.findValueInArray(globalConfig.repoConfigs,job.config.params.configName,"configName") === null)
    {
        logger.syslog("Requested configuration not found: " + job.config.params.configName, "Error");
        res.writeHead(400, {'Content-Type': 'text/plain'});
        res.end(JSON.stringify("Invalid request.  Requested configuration not found: " + job.config.params.configName));
        return;
    }

    jobs.push(job);
    logger.syslog("Processing request: " + job.config.params.configName + " jobID: " + job.jobID,"Processing");
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(JSON.stringify("Processing request.  JobID: " + job.jobID));

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
                    description: repoConfig.repositoryAttributes.description
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

                }
    if(!job.config.params.orgName) {
        job.github.repos.create(options)
            .then(function (err, res) {
                logger.log("Repository created. ID: " + err.id);
                job.repository = JSON.parse(JSON.stringify(err));
                configureTeams(job,repoConfig);
            }).catch(function (err) {
            logger.log("Error creating repository: " + err.message, job, "Failed", err);
            return;
        });
    }
    else
    {
        options.org = job.config.params.orgName;
        job.github.repos.createForOrg(options)
            .then(function (err, res) {
                logger.log("Repository created. ID: " + err.id);
                job.repository = JSON.parse(JSON.stringify(err));
            }).then(function (err,res)
            {
                configureTeams(job, repoConfig);
            }).catch(function (err) {
                logger.log("Error creating repository: " + err.message, job, "Failed", err);
                return;
            });
    }
}

function configureTeams(job, repoConfig) {
    if (job.config.params.orgName && repoConfig.teams) {
        //Get teams
        //Add specified teams
        var team;
        job.github.orgs.getTeams({org: job.config.params.orgName})
            .then(function (err, res) {
                for (var i = 0; i < repoConfig.teams.length; i++) {
                    //Make sure
                    team = arrayUtil.getArrayElementByKey(err, repoConfig.teams[i].team, "name");
                    if (team != null) {
                        job.github.orgs.addTeamRepo({
                            id: team.id
                            , org: job.config.params.orgName
                            , repo: job.repository.name
                            , permission: team.permission
                        })
                    }

                }
            }).then(function (err, res) {
            //Configure branches

            if (repoConfig.branches) {
               configBranches(job, repoConfig);
            }
        });
    }
}

function configBranches(job, repoConfig)
{
    //Create a ref with the SHA of the HEAD commit to branch from
    //So first, get the ref

    var commit;

    job.github.repos.getBranch({
        owner: job.repository.owner.login,
        repo: job.repository.name,
        branch: 'master'
    }).then(function (err, res)
        {
            /*job.github.gitdata.getTree(
                {owner: job.repository.owner.login
                 ,repo: job.repository.name
                 ,sha: err.commit.commit.tree.sha
                 ,recursive: true}
            )}).then(function(err, res)
            */
            job.commitSHA = err.commit.sha;
                for(var i = 0; i < repoConfig.branches.length; i++)
                {
                    //skip master.  Later find out what the default branch is and skip it
                    if(repoConfig.branches[i].name != 'master') {
                        job.github.gitdata.createReference(
                            {
                                owner: job.repository.owner.login
                                ,
                                repo: job.repository.name
                                ,
                                ref: 'refs/heads/' + repoConfig.branches[i].name
                                ,
                                sha: job.commitSHA
                            }
                        )
                    }
                }
            });

}

//From filesystem for now, ultimately from configured repository
function loadRepoConfigs()
{

    var fileNames = fs.readdirSync('./config/repo_templates');
    var configs = [];
    var config;
    logger.syslog("Loading configs", "Config");

    delete globalConfig["repoConfigs"];
    globalConfig.repoConfigs = [];

    for(var i = 0; i < fileNames.length; i++)
    {
        //Is it a JSON file? Or at least, does it have the extension JSON?
        if(fileNames[i].split('.').pop() === 'json')
        {

            try {
                config = JSON.parse(fs.readFileSync('./config/repo_templates/' + fileNames[i]));
                globalConfig.repoConfigs.push(JSON.parse(fs.readFileSync('./config/repo_templates/' + fileNames[i])));
                logger.syslog("Config " + fileNames[i] + " loaded","Config");
            }
            catch (e) {
                logger.syslog("Error parsing config: " + fileNames[i] + " :" + e.message, "Error");
            }
        }
        else
        {
            logger.syslog("Skipping non JSON file " + fileNames[i], "Starting");
        }
    }
}