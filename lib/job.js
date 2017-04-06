/**
 * Created by bryancross on 1/14/17.
 */

var format = require('date-fns/format');  //https://github.com/date-fns/date-fns
var fs = require('fs');
var crypto = require('crypto');
var GitHubClient = require("github"); //https://github.com/mikedeboer/node-github


module.exports = Job;

function Job(config)
{
    //this.config = JSON.parse(JSON.stringify(config));
    this.config = config;
    this.config.startTime = format(new Date());
    //Assign a (hopefully) unique ID
    this.jobID = crypto.randomBytes(20).toString('hex');
    this.msgs = [];
    this.errors = [];

    var pathPrefix = this.config.params.targetHost !== "github.com" ? "/api/v3" : ""

    //  Create a github client using the node-github API https://github.com/mikedeboer/node-github
    var github = new GitHubClient({
        debug: true //this.config.debug
        ,pathPrefix: pathPrefix
        ,host: this.config.params.targetHost
        ,protocol: "https"
        ,headers: {"user-agent":"repo-template"}
    });

    var authType = !this.config.params.authType ? this.config.authType : this.config.params.authType;

    //Create an auth object using configured values.  Will be used to authenticate the GitHub client
    var auth = {
        type: authType
        , token: this.config.params.userPAT
        , username: this.config.params.username
    };
    //authenticate using configured credentials
    github.authenticate(auth);
    //attach the client to the job object
    this.github = github;
};

Job.prototype.dumpConfig = function() {
    console.log("Config: " + JSON.stringify(this.config));
};

Job.prototype.flushToFile = function () {
    var logContent = {"jobID":this.jobID}
    logContent.msgs = JSON.parse(JSON.stringify(this.msgs));
    logContent.errors = JSON.parse(JSON.stringify(this.errors));
    logContent.config = JSON.parse(JSON.stringify(this.config));
    logContent.config.GitHubPAT = "<redacted>";
    fs.writeFile("./log/" + this.jobID + ".log", JSON.stringify(logContent), function(err)
    {
        if(err)
        {
            console.log("Error writing job log to file: " + err)
        }
    });



}


