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

logger.prototype.syslog = function(msg, status, error)
{
    var datestamp = format(new Date());
    var logString = datestamp + ":\t" + status + "\t\t " + msg +  (error ? error : "");
    console.log("SYSLOG: " + logString);
    if(fs.existsSync('./log/key2pdf.log'))
    {
        fs.appendFile('./log/key2pdf.log', "\n"+logString, function(err)
        {
            if(err)
            {
                console.log("Error appending to SYSLOG: " + err)
            }
        });
    }
    else
    {
        fs.writeFile("./log/key2pdf.log", logString, function(err)
        {
            if(err)
            {
                console.log("Error writing to SYSLOG: " + err)
            }
        });
    }

}

module.exports = new logger();
