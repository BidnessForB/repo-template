/**
 * Created by bryancross on 1/14/17.
 */

var format = require('date-fns/format');  //https://github.com/date-fns/date-fns
var fs = require('fs');

//replace with standard library
//https://www.loggly.com/ultimate-guide/node-logging-basics/


var logger = function() {};

logger.prototype.log = function(msg, job, status, error) {
    var datestamp = format(new Date());

    if(job)
    {
        if(status)
        {
            job.status = status;
        }
        job.msgs.push({"time": datestamp, "msg": msg});
        if(error)
        {
            job.errorMessage = error.message;
            job.errors.push(error.message);
        }
    }
    console.log(datestamp + ":    " + msg);
};

logger.prototype.endlog = function(msg,job,status,error)
{
    this.log(msg,job,status,error);
    job.flushToFile();
};

logger.prototype.syslog = function(msg, status, error)
{
    var datestamp = format(new Date());
    var logString = datestamp + ":\t" + status + "\t\t " + msg +  (error ? error : "");
    console.log("SYSLOG: " + logString);
    //awful hard-coded log file name is awful
    //In fact this whole thing is awful
    //Shift to a standard framework ASAP!
    if(fs.existsSync('./log/repo-template.log'))
    {
        //awful hard-coded log file name is awful
        //In fact this whole thing is awful
        //Shift to a standard framework ASAP!
        fs.appendFile('./log/repo-template.log', "\n"+logString, function(err)
        {
            if(err)
            {
                console.log("Error appending to SYSLOG: " + err)
            }
        });
    }
    else
    {
        //awful hard-coded log file name is awful
        //In fact this whole thing is awful
        //Shift to a standard framework ASAP!
        fs.writeFile("./log/repo-template.log", logString, function(err)
        {
            if(err)
            {
                console.log("Error writing to SYSLOG: " + err)
            }
        });
    }

}

module.exports = new logger();
