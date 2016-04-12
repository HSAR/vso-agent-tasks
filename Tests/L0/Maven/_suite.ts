/// <reference path="../../../definitions/mocha.d.ts"/>
/// <reference path="../../../definitions/node.d.ts"/>

import assert = require('assert');
import path = require('path');
import fs = require('fs');

import tr = require('../../lib/taskRunner');
import tl = require('vsts-task-lib/task');
import trm = require('vsts-task-lib/toolrunner');

function setResponseFile(filePath: string) {
    process.env['MOCK_RESPONSES'] = filePath;
}

// Sets up a Maven TaskRunner instance with all of the required default settings
function setupDefaultMavenTaskRunner():tr.TaskRunner {
    var taskRunner = new tr.TaskRunner('Maven');
    // default required settings
    taskRunner.setInput('mavenVersionSelection', 'Default');
    taskRunner.setInput('goals', 'package');
    taskRunner.setInput('javaHomeSelection', 'JDKVersion');
    taskRunner.setInput('jdkVersion', 'default');
    taskRunner.setInput('jdkArchitecture', 'x86');
    taskRunner.setInput('testResultsFiles', '**/TEST-*.xml');
    taskRunner.setInput('sqAnalysisEnabled', 'false');
    taskRunner.setInput('mavenPOMFile', 'pom.xml');

    return taskRunner;
}

describe('Maven Suite', function() {
    this.timeout(20000);

    before((done) => {
        // init here
        done();
    });

    after(function() {

    });

    it('Maven / PMD: Executes PMD goals if PMD is enabled', (done) => {
        // Arrange

        var testStgDir:string = path.join(__dirname, '_temp');
        var testSrcDir:string = path.join(__dirname, 'data');
        tl.rmRF(testStgDir);
        tl.mkdirP(testStgDir);

        tl.mkdirP(path.join(testStgDir, '.pmd')); // Manually create the .pmd subfolder for test purposes

        // Add test file(s) to the response file so that tl.exist() and tl.checkPath() calls return correctly
        var testXmlFilePath = path.join(testSrcDir, 'target', 'pmd.xml');
        var testHtmlFilePath = path.join(testSrcDir, 'target', 'site', 'pmd.html');
        var responseJsonFilePath:string = path.join(__dirname, 'mavenPmdGood.json');
        var responseJsonContent = JSON.parse(fs.readFileSync(responseJsonFilePath, 'utf-8'));

        responseJsonContent.exist = responseJsonContent.exist || {}; // create empty object only if it did not already exist
        responseJsonContent.exist[testXmlFilePath] = true;
        responseJsonContent.exist[testHtmlFilePath] = true;

        responseJsonContent.checkPath = responseJsonContent.checkPath || {};
        responseJsonContent.checkPath[testXmlFilePath] = true;
        responseJsonContent.checkPath[testHtmlFilePath] = true;

        responseJsonContent.rmRF = responseJsonContent.rmRF || {};
        responseJsonContent.rmRF[testStgDir] = {
            success: true,
            message: "foo bar"
        };
        responseJsonContent.rmRF[path.join(testStgDir, '.pmd')] = { // PMD subdir is used for artifact staging
            success: true,
            message: "foo bar"
        };

        responseJsonContent.mkdirP = responseJsonContent.mkdirP || {};
        responseJsonContent.mkdirP[testStgDir] = true;
        responseJsonContent.mkdirP[path.join(testStgDir, '.pmd')] = true;

        var newResponseFilePath:string = path.join(testStgDir, 'response.json');
        fs.writeFileSync(newResponseFilePath, JSON.stringify(responseJsonContent));

        // Set the newly-changed response file
        setResponseFile(newResponseFilePath);

        // Set up the task runner with the test settings
        var taskRunner:tr.TaskRunner = setupDefaultMavenTaskRunner();
        taskRunner.setInput('pmdAnalysisEnabled', 'true');
        taskRunner.setInput('test.artifactStagingDirectory', testStgDir);
        taskRunner.setInput('test.sourcesDirectory', testSrcDir);

        // Act
        taskRunner.run()
            .then(() => {
                console.log(taskRunner.stdout);

                // Assert
                assert(taskRunner.resultWasSet, 'should have set a result');
                assert(taskRunner.stdout.length > 0, 'should have written to stdout');
                assert(taskRunner.succeeded, 'task should have succeeded');

                assert(taskRunner.ran('/usr/local/bin/mvn -f pom.xml package jxr:jxr pmd:pmd'),
                    'should have run maven with the correct arguments');
                assert(taskRunner.stdout.indexOf('task.addattachment type=Distributedtask.Core.Summary;name=Code Analysis Report') > -1,
                    'should have uploaded a Code Analysis Report build summary');
                assert(taskRunner.stdout.indexOf('artifact.upload containerfolder=codeAnalysis;artifactname=PMD') > -1,
                    'should have uploaded PMD build artifacts');

                done();
            })
            .fail((err) => {
                done(err);
            });
    });

    it('Maven / PMD: Skips PMD goals if PMD is not enabled', (done) => {
        // Arrange
        var testStgDir:string = path.join(__dirname, '_temp');
        var testSrcDir:string = path.join(__dirname, 'data');
        tl.rmRF(testStgDir);
        tl.mkdirP(testStgDir);

        setResponseFile(path.join(__dirname, 'mavenGood.json'));

        // Set up the task runner with the test settings
        var taskRunner:tr.TaskRunner = setupDefaultMavenTaskRunner();
        taskRunner.setInput('pmdAnalysisEnabled', 'false');
        taskRunner.setInput('test.artifactStagingDirectory', testStgDir);
        taskRunner.setInput('test.sourcesDirectory', testSrcDir);

        // Act
        taskRunner.run()
            .then(() => {
                //console.log(taskRunner.stdout);

                // Assert
                assert(taskRunner.resultWasSet, 'should have set a result');
                assert(taskRunner.stdout.length > 0, 'should have written to stdout');
                assert(taskRunner.succeeded, 'task should have succeeded');

                assert(taskRunner.ran('/usr/local/bin/mvn -f pom.xml package'),
                    'should have run maven without PMD arguments');
                assert(taskRunner.stdout.indexOf('task.addattachment type=Distributedtask.Core.Summary;name=Code Analysis Report') < 1,
                    'should not have uploaded a Code Analysis Report build summary');

                done();
            })
            .fail((err) => {
                done(err);
            });
    });

    it('Maven / PMD: Should fail if XML output cannot be found', (done) => {
        // Arrange

        var testStgDir:string = path.join(__dirname, '_temp');
        var testSrcDir:string = path.join(__dirname, 'data');
        tl.rmRF(testStgDir);
        tl.mkdirP(testStgDir);

        // Add test file(s) to the response file so that tl.exist() and tl.checkPath() calls return correctly
        var testXmlFilePath = path.join(testSrcDir, 'target', 'pmd.xml');
        var testHtmlFilePath = path.join(testSrcDir, 'target', 'site', 'pmd.html');
        var srcResponseFilePath:string = path.join(__dirname, 'mavenPmdGood.json');
        var responseJsonContent = JSON.parse(fs.readFileSync(srcResponseFilePath, 'utf-8'));

        responseJsonContent.exist[testXmlFilePath] = false; // return false for the XML file path
        responseJsonContent.exist[testHtmlFilePath] = true;
        responseJsonContent.checkPath[testXmlFilePath] = false;// return false for the XML file path
        responseJsonContent.checkPath[testHtmlFilePath] = true;
        var newResponseFilePath:string = path.join(testStgDir, 'response.json');
        fs.writeFileSync(newResponseFilePath, JSON.stringify(responseJsonContent));

        // Set the newly-changed response file
        setResponseFile(newResponseFilePath);

        // Set up the task runner with the test settings
        var taskRunner:tr.TaskRunner = setupDefaultMavenTaskRunner();
        taskRunner.setInput('pmdAnalysisEnabled', 'true');
        taskRunner.setInput('test.artifactStagingDirectory', testStgDir);
        taskRunner.setInput('test.sourcesDirectory', testSrcDir);

        // Act
        taskRunner.run()
            .then(() => {
                //console.log(taskRunner.stdout);

                // Assert
                assert(taskRunner.resultWasSet, 'should have set a result');
                assert(taskRunner.stdout.length > 0, 'should have written to stdout');
                assert(taskRunner.failed, 'task should have failed');

                assert(taskRunner.ran('/usr/local/bin/mvn -f pom.xml package jxr:jxr pmd:pmd'),
                    'should have run maven with the correct arguments');

                done();
            })
            .fail((err) => {
                console.log(taskRunner.stderr);
                done(err);
            });
    });
});