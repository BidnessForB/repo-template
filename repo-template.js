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

logger.syslog("Server startup","Starting");
//GitHub Enterprise uses /api/v3 as a prefix to REST calls, while GitHub.com does not.
globalConfig.pathPrefix = (globalConfig.targetHost !== "github.com") ? "/api/v3" : "";

//If we're going to GitHub, prepend the host with 'api', otherwise leave it be
globalConfig.targetHost = (globalConfig.targetHost === "github.com") ? "api.github.com" : globalConfig.targetHost;

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



//Create a server
var server = http.createServer(dispatchRequest);

//Startup the server

server.listen(globalConfig.listenOnPort == null ? PORT : globalConfig.listenOnPort, function () {
    //Callback when server is successfully listening
    logger.syslog("Server listening on: http://localhost: " + PORT, "Started");
});

//handle a call to /status.  Find the job in jobs, or if it isn't in the array find the log directory, and
//return the job log data.
dispatcher.onPost('/createRepo', function (req, res)
{

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
    logger.syslog("Processing request: " + job.config.params.configName + " jobID: " + job.jobID,"Processing");
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(JSON.stringify("Processing request.  JobID: " + job.jobID));

    createRepo(job);

});

function createRepo(job)
{
    console.log("Yup");
}