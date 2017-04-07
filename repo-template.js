/**
 * Created by bryancross on 12/27/16.
 *
 */

"use strict";
var logger = require('./lib/logger.js');
var arrayUtil = require('./lib/arrayUtil.js');

//Native NodeJS url package keeps coming up undefined...
var URL = require('url');

//var crypto = require('crypto');
//var exec = require('child_process').exec;
var GitHubClient = require("github"); //https://github.com/mikedeboer/node-github
var adminGitHub  = require("github"); //https://github.com/mikedeboer/node-github
var globalConfig = require("./config/config.json");
var fs = require('fs');
var http = require('http');
var Job = require('./lib/job.js');
var HttpDispatcher = require('httpdispatcher');
var dispatcher     = new HttpDispatcher();
const PORT = 3000;
//var parse = require('date-fns/parse');  //https://github.com/date-fns/date-fns
//var format = require('date-fns/format');  //https://github.com/date-fns/date-fns
var differenceInMilliseconds = require('date-fns/difference_in_milliseconds'); //https://github.com/date-fns/date-fns
var jobs = [];
var suspended = false;

logger.syslog("Server startup","Starting");

adminGitHub = new GitHubClient({
    debug: globalConfig.githubAPIDebug
    ,pathPrefix: globalConfig.TemplateSourceHost !== "github.com" ? "/api/v3" : ""
    ,host: globalConfig.TemplateSourceHost === 'github.com' ? 'api.github.com' : globalConfig.TemplateSourceHost
    ,protocol: "https"
    ,headers: {"user-agent":"repo-template"}
});

var adminAuth = {
    type: globalConfig.authType
    , token: globalConfig.AdminGitHubPAT
    , username: globalConfig.adminUsername
};
//authenticate using configured credentials
adminGitHub.authenticate(adminAuth);

//Load repository configs
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

dispatcher.onPost('/repocreated', function(req,res)
{
    logger.syslog("Repository creation event received","Running");
    res.writeHead(202, {'Content-Type': 'text/plain'});
    res.end("");

   var repoJSON;
    try
    {
        repoJSON = JSON.parse(req.body);
    }
    catch(e)
    {
        logger.syslog("Exception parsing repository create JSON","Repo Create Event",e);
        return;
    }

    if(repoJSON.action != 'created')
    {
        logger.syslog("Ignoring repository creation event action: " + repoJSON.action, "Repo Create Event");
        return;
    }

    var expr = 'Created by repo-template';
    if(repoJSON.repository.description && repoJSON.repository.description.search(expr))
    {
        logger.syslog("Ignoring repository created by repo-template","Repo Create Event");
        return;
    }


    var URL = require('url');

    if(!URL.parse(req.url).query)
    {
        logger.syslog('No parameters found for repository creation event','Repo Create Event');
        return;
    }

    var configName;

    try
    {
        configName = URL.parse(req.url).query.split('=')[1]
    }
    catch(e)
    {
        logger.syslog('Error parsing parameters from url: ' + req.url);
        return;
    }

    var repoConfig = arrayUtil.getArrayElementByKey(globalConfig.repoConfigs,configName,'configName');

    if(repoConfig === null)
    {
        logger.syslog('Could not find repository configuration with name: ' + configName);
        return;
    }

    var jobConfig = JSON.parse(JSON.stringify(globalConfig));
    jobConfig.params.username=globalConfig.adminUsername;
    jobConfig.params.targetHost = URL.parse(repoJSON.repository.html_url).hostname;
    jobConfig.params.configName = configName;
    jobConfig.params.userPAT = globalConfig.AdminGitHubPAT;
    jobConfig.params.username = globalConfig.adminUsername;
    jobConfig.params.orgName = repoJSON.repository.owner.login;






    var job = new Job(jobConfig);
    job.repoConfig = repoConfig;
    job.source = "repocreated";
    jobs.push(job);
    logger.syslog("Processing repository creation event request: " + job.config.params.configName + " jobID: " + job.jobID,"Processing");

    //Make sure the repository is initialized
    /*
    cd
    echo "Created by repo-template" >> repo-template.md
    git init
    git add README.md
    git commit -m "first commit"
    git remote add origin https://github.com/BidnessForB/foo.git
    git push -u origin master
    */
    job.github.repos.get({
        "owner":repoJSON.repository.owner.login
        ,"repo":repoJSON.repository.name
    }).then(function(err,res){
        job.repository = JSON.parse(JSON.stringify(err));
        configureTeams(job);
    })



});

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

dispatcher.onPost('/pullrequest', function(req,res)
{

    res.writeHead(202, {'Content-Type': 'text/plain'});
    res.end("");
    if(suspended)
   {
       logger.syslog("PR event skipped: suspended","Suspended");
       return;
   }
    var PR = JSON.parse(req.body);
    if(!PR.pull_request || !PR.pull_request.merged || PR.pull_request.body.length < 18)
    {
        logger.syslog("Unmerged PR events","Running");
        return;
    }

    if(!PR.pull_request.merged)
    {
        logger.syslog("Unmerged PR events","Running");
        return;
    }
    var PRBody = PR.pull_request.body.replace(/[\n\r]+/g,'')
    var params;
    if(PRBody.substring(0,18) != 'REPOSITORY_REQUEST')
    {
        logger.syslog("Ignoring non repository request PR", "Running");
        return;
    }

    try
    {
        params = JSON.parse(PRBody.substring(18));
    }
    catch(e)
    {
        logger.syslog("Error parsing Pull Request JSON: " + e.message, "PR Failed",e);
        return;
    }

    params.userPAT = globalConfig.AdminGitHubPAT;

    if (!params.targetHost || !params.newRepoName || !params.configName || !params.orgName || !params.userPAT || !params.username)
    {
        logger.syslog("PR event missing parameters: " + JSON.stringify(params));
        return;
    }

    var repoConfig = arrayUtil.getArrayElementByKey(globalConfig.repoConfigs,params.configName,'configName');

    if(repoConfig == null)
    {
        logger.syslog("No config found for name: " + params.configName,"Failed");
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
        ,"body":"Your repo-template jobID: " + job.jobID + ". Check [here](http://https://976986a5.ngrok.io/status?jobID=" + job.jobID + " for status info."
    }).then(function (req,res){
        job.PRCommentID = req.id;
        createRepo(job);
    });

});

dispatcher.onGet('/status', function(req,res)
{

    logger.syslog("Status request received","Status");

    var URL = require('url');
    var jobID;


    if(!URL.parse(req.url).query)
    {
        var statusJSON = {"serverState":suspended ? "suspended" : "active"}
        logger.syslog("Received status request","Status");
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end(JSON.stringify(statusJSON));
        return;
    }

    try
    {
        jobID = URL.parse(req.url).query.split('=')[1]
    }
    catch(e)
    {
        logger.syslog('Error parsing parameters from url: ' + req.url,"Status");
        return;
    }

    ///Search the array of jobs in memory
    //var id = arrayUtil.findValueInArray(jobs, jobID, "jobID");
    var curJob = arrayUtil.getArrayElementByKey(jobs,jobID,"jobID");
    if(curJob)
    {
        curJob = JSON.parse(JSON.stringify(curJob));

        //Delete the github object, since it is 1000s of lines long
        //Redact the PAT as well.
        try
        {
            curJob.config.AdminGitHubPAT = "<redacted>";
            delete curJob["github"];
            curJob.params.userPAT = "<redacted>";
        }
        catch(e)
        {
            logger.syslog("No github object in job: " + jobID,"Error");
        }
        logger.syslog("Serviced status request for job with ID: " + curJob.jobID);
        res.writeHead(200, {'Content-Type': 'text/plain'});
        res.end(JSON.stringify(curJob));
        return;
    }
    //If we're still here the job is finished and the job object deleted from the global array
    //So let's see if there's info in the log...
    try
    {
        var logData = fs.readFileSync('./log/' + jobID + '.log', "UTF-8");
        logData = JSON.parse(logData);
        logData.config.GitHubPAT = "<redacted>";
        delete logData["github"];
        logData = JSON.stringify(logData);
        res.end(logData);
    }
    catch(err)
    {
        //no file found
        if(err.errno === -2)
        {
            res.writeHead(404,{'Content-Type':'text/plain'})
            res.end("No job data found for job ID: " + jobID);
        }
        //something else went wrong
        else
        {
            res.writeHead(500,{'Content-Type':'text/plain'});
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
        res.writeHead(400, {'Content-Type': 'text/plain'});
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
                    description: repoConfig.repositoryAttributes.description + " --Created by repo-template"
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
        options.org = job.config.params.orgName;
        job.github.repos.createForOrg(options)
            .then(function (err, res) {
                logger.log("Repository created. ID: " + err.id,job,"Success");
                job.repository = JSON.parse(JSON.stringify(err));
            }).then(function (err,res)
            {
                configureTeams(job, repoConfig);
            }).catch(function (err) {
                logger.endlog("Error creating repository: " + err.message, job, "Failed", err);
                return;
            });
    }
}

function configureTeams(job) {
    if (job.config.params.orgName && job.repoConfig.teams) {
        //Get teams
        //Add specified teams
        var team;
        job.github.orgs.getTeams({org: job.config.params.orgName})
            .then(function (err, res) {
                for (var i = 0; i < job.repoConfig.teams.length; i++) {
                    //Make sure
                    team = arrayUtil.getArrayElementByKey(err, job.repoConfig.teams[i].team, "name");
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

            if (job.repoConfig.branches) {
               configBranches(job);
            }
        }).catch(function (err)
            {
               logger.endlog("Error creating branches", job, "Failed");
               return;
            });
    }
}

function configBranches(job)
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
            job.commitSHA = err.commit.sha;
                for(var i = 0; i < job.repoConfig.branches.length; i++)
                {
                    //skip master.  Later find out what the default branch is and skip it
                    if(job.repoConfig.branches[i].name != 'master') {
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
                        ).then(function(err,res) {

                            var index = arrayUtil.findValueInArray(job.repoConfig.branches,err.ref.split('/').pop(),"name");
                            var branch = job.repoConfig.branches[index];

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
                                job.github.repos.updateBranchProtection(params).then(function(err,res){
                                    logger.endlog("Repository creation complete: " + job.repository.name,job,"Success");
                                    logger.syslog("Repository creation complete: " + job.repository.name);

                                })
                            }}).catch(function(err)
                        {
                            //"message":"Branch not found" when master doesn't exit
                            logger.endlog("Error creating repository: " + err.message,job,"Failed");
                        })
                    }
                }
            });

};

//From filesystem for now, ultimately from configured repository
/*function loadRepoConfigs()
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
    logger.syslog(globalConfig.repoConfigs.length + " repository configurations loaded.");
}*/

function loadRepoConfigs()
{

    var configs = [];
    var config;
    logger.syslog("Loading configs", "Config");

    delete globalConfig["repoConfigs"];
    globalConfig.repoConfigs = [];
    logger.syslog("Loading repository configurations","Loading");

    var repoDir =     adminGitHub.repos.getContent({
        "owner":globalConfig.TemplateSourceRepo.split('/')[0]
        ,"repo":globalConfig.TemplateSourceRepo.split('/').pop()
        ,"path":globalConfig.TemplateSourcePath
        ,"ref":globalConfig.TemplateSourceBranch
    }).catch(function(err){
        logger.syslog("Error retrieving repository configurations: " + err.message,"Failed");
        process.exit(0);
    });


    var file = repoDir.then(function(err,res){
        for(var i = 0;i < err.length; i++) {
            adminGitHub.repos.getContent({
                "owner": globalConfig.TemplateSourceRepo.split('/')[0]
                , "repo": globalConfig.TemplateSourceRepo.split('/').pop()
                , "path": err[i].path
                , "ref": globalConfig.TemplateSourceBranch
            }).then(function (err, res) {
                var B64 = require('js-base64/base64.js').Base64;
                var config = JSON.parse(B64.decode(err.content));
                globalConfig.repoConfigs.push(config);
                logger.syslog("Loaded config: " + config.configName,"Loading");
            }).catch(function(err)
            {
                logger.syslog("Error loading repository configurations: " + err.message, "Failed");
                process.exit(0);
            });
        }
        });
    };



    /*

    //get the directory
    adminGitHub.repos.getContent({
                        "owner":globalConfig.TemplateSourceRepo.split('/')[0]
                        ,"repo":globalConfig.TemplateSourceRepo.split('/').pop()
                        ,"path":globalConfig.TemplateSourcePath
                        ,"ref":globalConfig.TemplateSourceBranch
                    }).then(function(err,res){
                for(var i = 0; i < err.length; i++)
                {
                    adminGitHub.repos.getContent({
                        "owner":globalConfig.TemplateSourceRepo.split('/')[0]
                        ,"repo":globalConfig.TemplateSourceRepo.split('/').pop()
                        ,"path":err[i].path
                        ,"ref":globalConfig.TemplateSourceBranch
                    }).then(function(err,res){
                        var b64 = require('js-base64/base64.js').Base64;




                    })


                }


    })

    //Get config files from repository

*/
