/**
 * Created by bryancross on 1/14/17.
 */

var format = require('date-fns/format');  //https://github.com/date-fns/date-fns
var fs = require('fs');
var crypto = require('crypto');
var GitHubClient = require("github"); //https://github.com/mikedeboer/node-github


module.exports = Job;

function Job(template, reqParams)
{
    var config = template;
    config.params = reqParams;

    config.startTime = format(new Date());
    //Assign a (hopefully) unique ID
    config.jobID = crypto.randomBytes(20).toString('hex');

    var pathPrefix = config.params.targetHost !== "github.com" ? "/api/v3" : ""

    //  Create a github client using the node-github API https://github.com/mikedeboer/node-github
    var github = new GitHubClient({
        debug: config.config.debug,
        pathPrefix: pathPrefix
    });

    //Create an auth object using configured values.  Will be used to authenticate the GitHub client
    var auth = {
        type: config.authType
        , token: config.GitHubPAT
        , username: config.user
    };
    //authenticate using configured credentials
    github.authenticate(auth);
    //attach the client to the job object
    this.github = github;

    this.dumpConfig = function() {
        console.log("Config: " + JSON.stringify(config));
    }

}


