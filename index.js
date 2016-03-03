'use strict'

var AWS         = require('aws-sdk');
var fs          = require('fs');
var mime        = require('mime');
var chalk       = require('chalk');

var s3;
var cloudFormation;

exports.registerTasks = function ( gulp, opts ) {
    // AWS services
    AWS.config.region = opts.region
    s3             = new AWS.S3();
    cloudFormation = new AWS.CloudFormation();

    var stackName = opts.stackName || 'serverless-pipeline';
    var cfnBucket = opts.cfnBucket || 'serverless-pipeline';
    var taskPrefix = opts.taskPrefix || 'pipeline';


    gulp.task(taskPrefix+':up',  function(cb) {
        return getStack(stackName, function(err, stack) {
            var action, status = stack && stack.StackStatus;
            if (!status || status === 'DELETE_COMPLETE') {
                action = 'createStack';
            } else if (status.match(/(CREATE|UPDATE)_COMPLETE/)) {
                action = 'updateStack';
            } else {
                return console.error('Stack "' + stackName + '" is currently in ' + status + ' status and can not be deployed.');
            }


            var s3Endpoint = (opts.region=='us-east-1'?'https://s3.amazonaws.com':'https://s3-'+opts.region+'.amazonaws.com');
            var s3BucketURL = s3Endpoint+'/'+cfnBucket;


            var params = {
                StackName: stackName,
                Capabilities: ['CAPABILITY_IAM'],
                Parameters: [
                    {
                        ParameterKey: "GitHubUser",
                        ParameterValue: opts.githubUser
                    },
                    {
                        ParameterKey: "GitHubToken",
                        ParameterValue: opts.githubToken
                    },
                    {
                        ParameterKey: "GitHubRepo",
                        ParameterValue: opts.githubRepo
                    },
                    {
                        ParameterKey: "GitHubBranch",
                        ParameterValue: opts.githubBranch
                    },
                    {
                        ParameterKey: "GulpStaticAnalysisTask",
                        ParameterValue: opts.gulpStaticAnalysisTask
                    },
                    {
                        ParameterKey: "GulpUnitTestTask",
                        ParameterValue: opts.gulpUnitTestTask
                    },
                    {
                        ParameterKey: "GulpLaunchTask",
                        ParameterValue: opts.gulpLaunchTask
                    },
                    {
                        ParameterKey: "GulpWaitForReadyTask",
                        ParameterValue: opts.gulpWaitForReadyTask
                    },
                    {
                        ParameterKey: "GulpWaitForReadyRetries",
                        ParameterValue: opts.gulpWaitForReadyRetries
                    },
                    {
                        ParameterKey: "GulpDeployAppTask",
                        ParameterValue: opts.gulpDeployAppTask
                    },
                    {
                        ParameterKey: "GulpDeploySiteTask",
                        ParameterValue: opts.gulpDeploySiteTask
                    },
                    {
                        ParameterKey: "GulpDeployConfigTask",
                        ParameterValue: opts.gulpDeployConfigTask
                    },
                    {
                        ParameterKey: "GulpFunctionalTestTask",
                        ParameterValue: opts.gulpFunctionalTestTask
                    },
                    {
                        ParameterKey: "GulpProductionDNSTask",
                        ParameterValue: opts.gulpProductionDNSTask
                    },
                    {
                        ParameterKey: "TemplateBucketName",
                        ParameterValue: cfnBucket
                    }
                ],
                TemplateURL: s3BucketURL+"/master.json"
            };
            params.Parameters = params.Parameters.filter(function(p) { return p.ParameterValue; });

            cloudFormation[action](params, function(err) {
                if (err) {
                    cb(err);
                } else {
                    var a = action === 'createStack' ? 'creation' : 'update';
                    console.log('Stack ' + a + ' in progress.');
                    cb();
                }
            });
        });
    });

    gulp.task(taskPrefix+':emptyArtifacts', function(callback) {
        getStack(stackName,function(err, stack) {
            if (err) {
                callback(err);
            } else if (!stack) {
                callback();
            } else {
                var artifactBucket = stack.Outputs.filter(function (o) { return o.OutputKey == 'ArtifactBucket' })[0].OutputValue;
                emptyBucket(artifactBucket, callback);
            }
        });
    });

    gulp.task(taskPrefix+':down', [taskPrefix+':emptyArtifacts'], function() {
        return getStack(stackName, function(err) {
            if (err) { throw err; }

            cloudFormation.deleteStack({StackName: stackName}, function(err) {
                if (err) {
                    throw err;
                }
                console.log('Stack deletion in progress.');
            });
        });
    });

    gulp.task(taskPrefix+':wait', function(cb) {
        var checkFunction = function() {
            getStack(stackName, function(err,stack) {
                if (err) {
                    throw err;
                } else {
                    if(!stack || /_IN_PROGRESS$/.test(stack.StackStatus)) {
                        console.log("      StackStatus = "+(stack!=null?stack.StackStatus:'NOT_FOUND'));
                        setTimeout(checkFunction, 5000);
                    } else {
                        console.log("Final StackStatus = "+stack.StackStatus);
                        cb();
                    }
                }
            });
        };

        checkFunction();
    });

    gulp.task(taskPrefix+':status', function() {
        return getStack(stackName, function(err, stack) {
            if (err) {
                throw err;
            }
            if (!stack) {
                return console.error('Stack does not exist: ' + stackName);
            }
            console.log('Status: '+stack.StackStatus);
            console.log('Outputs: ');
            stack.Outputs.forEach(function (output) {
                console.log('  '+output.OutputKey+' = '+output.OutputValue);
            });
            console.log('');
            console.log('Use gulp pipeline:log to view full event log');
        });
    });
    gulp.task(taskPrefix+':stacks', function(cb) {
        getStack(stackName,function(err, stack) {
            if (err) {
                cb(err);
            } else if (!stack) {
                cb();
            } else {
                var pipelineName = stack.Outputs.filter(function (o) { return o.OutputKey == 'PipelineName' })[0].OutputValue;
                cloudFormation.describeStacks({}, function(err, data) {
                    if (err) {
                        cb(err);
                    } else if(data.Stacks == null) {
                        cb(null,null);
                    } else {
                        var stackNames = [];
                        var stacks = data.Stacks.filter(function(s) {
                            if(!s.Tags) {
                                return false;
                            }


                            // check if the pipeline name tag matches
                            var match = s.Tags.filter(function(t) { return (t.Key == 'PipelineName' && t.Value == pipelineName); }).length > 0;
                            if(match) {
                                stackNames.push(s.StackName);
                            }
                            return match;
                        });

                        if(!stacks || !stacks.length) {
                            console.log("No stacks defined with Tag 'PipelineName' == "+pipelineName);
                        } else {
                            stacks.forEach(function(s) {
                                // check if this is a sub-stack
                                if(stackNames.filter(function (stackName) {
                                        return (stackName.length < s.StackName.length && s.StackName.indexOf(stackName) == 0);
                                }).length > 0) {
                                    return;
                                }


                                var appVersion;
                                try {
                                    appVersion = s.Tags.filter(function(t) { return (t.Key == 'ApplicationVersion'); })[0].Value;
                                } catch (e) {}

                                var appName;
                                try {
                                    appName = s.Tags.filter(function (t) { return (t.Key == 'ApplicationName'); })[0].Value;
                                } catch (e) {}
                                var label = chalk.blue.bold;
                                console.log(chalk.red.underline(s.StackName)+" => "+label("Status:")+ s.StackStatus+label(" Created:")+ s.CreationTime+label(" AppName:")+appName+label(" AppVersion:")+appVersion+label(""));
                            });
                        }
                    }
                    return cb();
                });
            }
        });
    });

    gulp.task(taskPrefix+':log', function() {
        return getStack(stackName, function(err, stack) {
            if (err) {
                throw err;
            }
            if (!stack) {
                return console.log('Stack does not exist: ' + stackName);
            }
            if (!stack.StackStatus.match(/(CREATE|UPDATE)_COMPLETE/)) {
                cloudFormation.describeStackEvents({StackName: stackName}, function(err, data) {
                    if (!data) {
                        console.log('No log info available for ' + stackName);
                        return;
                    }
                    var events = data.StackEvents;
                    events.sort(function(a, b) {
                        return new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime();
                    });
                    events.forEach(function(event) {
                        event.Timestamp = new Date(event.Timestamp).toLocaleString().replace(',', '');
                        event.ResourceType = '[' + event.ResourceType + ']';
                        console.log(event.Timestamp+' '+event.ResourceStatus+' '+event.LogicalResourceId+event.ResourceType+' '+event.ResourceStatusReason);
                    });
                });
            }
        });
    });


};



var getStack = function(stackName, cb) {
    cloudFormation.describeStacks({StackName: stackName}, function(err, data) {
        if (err || data.Stacks == null) {
            cb(null,null);
            return;
        }
        for (var i=0; i<data.Stacks.length; i++) {
            if (data.Stacks[i].StackName === stackName) {
                return cb(null, data.Stacks[i]);
            }
        }
        return cb();
    });
};
exports.getStack = getStack;

var emptyBucket = function(bucket,cb) {
    s3.listObjects({Bucket: bucket}, function(err, data) {
        if (err) {
            cb();
        } else {

            var objects = data.Contents.map(function (c) { return { Key: c.Key }});
            var params = {
                Bucket: bucket,
                Delete: {
                    Objects: objects
                }
            };

            if(objects.length > 0) {
                s3.deleteObjects(params, function(err) {
                    if (err) {
                        cb(err);
                    } else {
                        cb();
                    }
                });
            } else {
                cb();
            }
        }
    });
};
exports.emptyBucket = emptyBucket;

var uploadToS3 = function(dir,bucket,cb) {
    var files = fs.readdirSync(dir);
    var respCount = 0;
    for (var i in files){
        var path = dir + '/' + files[i];
        if (!fs.statSync(path).isDirectory()) {
            console.log("Uploading: "+ path);
            var params = {
                Bucket: bucket,
                Key: files[i],
                ACL: 'public-read',
                ContentType: mime.lookup(path),
                Body: fs.readFileSync(path)
            }

            s3.putObject(params, function(err, data) {
                if (err) {
                    console.log(err, err.stack);
                }

                if(++respCount >= files.length) {
                    cb();
                }
            });
        } else {
            respCount++;
        }
    }

    if(files.length==0) {
        cb();
    }
};
exports.uploadToS3 = uploadToS3;


