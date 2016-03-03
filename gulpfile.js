'use strict'

var gulp        = require('gulp');
var gutil       = require('gulp-util');
var install     = require('gulp-install');
var zip         = require('gulp-zip');
var del         = require('del');
var AWS         = require('aws-sdk');
var fs          = require('fs');


var opts = {
    region: (gutil.env.region || 'us-west-2'),
    stackName: (gutil.env.stackName || 'serverless-pipeline'),
    cfnBucket: (gutil.env.templateBucket || 'serverless-pipeline'),
    githubToken: gutil.env.token,
    githubUser: 'stelligent',
    githubRepo: 'dromedary-serverless',
    githubBranch: 'master'
}
var gpipeline = require('.')
gpipeline.registerTasks(gulp,opts);

var lambda      = new AWS.Lambda();
var s3          = new AWS.S3();
var dist        = 'dist';


gulp.task('lambda:clean', function(cb) {
    return del([dist],{force: true}, cb);
});

gulp.task('lambda:js', function() {
    return gulp.src([__dirname+'/lambda/index.js'])
        .pipe(gulp.dest(dist+'/lambda/'));
});

gulp.task('lambda:install', function() {
    return gulp.src(__dirname+'/lambda/package.json')
        .pipe(gulp.dest(dist+'/lambda/'))
        .pipe(install({production: true}));
});

gulp.task('lambda:zip', ['lambda:js','lambda:install'], function() {
    return gulp.src(['!'+dist+'/lambda/package.json','!'+dist+'/**/aws-sdk{,/**}',dist+'/lambda/**/*'])
        .pipe(zip('pipeline-lambda.zip'))
        .pipe(gulp.dest(dist));
});

gulp.task('lambda:upload', ['lambda:gulpUpload', 'lambda:npmUpload']);

gulp.task('lambda:gulpUpload', ['lambda:zip'], function(callback) {
    gpipeline.getStack(opts.stackName,function(err, stack) {
        if(err) {
            callback(err);
        } else if(!stack) {
            callback();
        } else {
            var pipelineFunctionArn = stack.Outputs.filter(function (o) { return o.OutputKey == 'CodePipelineGulpLambdaArn'})[0].OutputValue;
            var params = {
                FunctionName: pipelineFunctionArn,
                Publish: true,
                ZipFile: fs.readFileSync(dist+'/pipeline-lambda.zip')
            };
            console.log("About to update function..."+pipelineFunctionArn);
            lambda.updateFunctionCode(params, function(err, data) {
                if (err) {
                    callback(err);
                } else {
                    console.log("Updated lambda to version: "+data.Version);
                    callback();
                }
            });

        }
    })
});
gulp.task('lambda:npmUpload', ['lambda:zip'], function(callback) {
    gpipeline.getStack(opts.stackName,function(err, stack) {
        if(err) {
            callback(err);
        } else if(!stack) {
            callback();
        } else {
            var pipelineFunctionArn = stack.Outputs.filter(function (o) { return o.OutputKey == 'CodePipelineNpmLambdaArn'})[0].OutputValue;
            var params = {
                FunctionName: pipelineFunctionArn,
                Publish: true,
                ZipFile: fs.readFileSync(dist+'/pipeline-lambda.zip')
            };
            console.log("About to update function..."+pipelineFunctionArn);
            lambda.updateFunctionCode(params, function(err, data) {
                if (err) {
                    callback(err);
                } else {
                    console.log("Updated lambda to version: "+data.Version);
                    callback();
                }
            });

        }
    })
});

// Tasks to provision the pipeline
gulp.task('cfn:templatesBucket', function(cb) {
    s3.headBucket({ Bucket: opts.cfnBucket }, function(err, data) {
        if (err) {
            if(err.statusCode == 404) {
                s3.createBucket({
                    Bucket: opts.cfnBucket,
                    CreateBucketConfiguration: {
                        LocationConstraint: opts.region
                    }
                }, function(err, data) {
                    if (err) {
                        cb(err);
                    } else {
                        console.log('Created bucket: '+opts.cfnBucket);
                        cb();
                    }
                });
            } else {
                cb(err);
            }
        } else {
            console.log('Bucket already exists:'+ opts.cfnBucket);
            cb();
        }
    });
});

gulp.task('cfn:templates',['cfn:templatesBucket'], function(cb) {
    var complete = 0;
    var dirs = [__dirname+'/cfn'];
    dirs.forEach(function(dir) {
        gpipeline.uploadToS3(dir,opts.cfnBucket,function(err) {
            if(err) {
                cb(err);
            } else {
                if (++complete >= dirs.length) {
                    cb();
                }
            }
        });
    });
});


gulp.task('lambda:uploadS3', ['lambda:zip','cfn:templatesBucket'], function(cb) {
    var path = dist+'/pipeline-lambda.zip';
    var params = {
        Bucket: opts.cfnBucket,
        Key: 'pipeline-lambda.zip',
        ACL: 'public-read',
        Body: fs.readFileSync(path)
    }

    s3.putObject(params, function(err, data) {
        if (err) {
            cb(err);
        } else {
            cb();
        }
    });
});

gulp.task('publish',['cfn:templates','lambda:uploadS3'],  function() {
});


