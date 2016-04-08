/// <reference path="../../../definitions/mocha.d.ts"/>
/// <reference path="../../../definitions/node.d.ts"/>
/// <reference path='../../../Tasks/Maven/pmdForMaven.ts'/>

import assert = require('assert');
import path = require('path');
import fs = require('fs');

import tr = require('../../lib/taskRunner');
import tl = require('vsts-task-lib/task');
import trm = require('vsts-task-lib/toolrunner');

import pmd = require('../../../Tasks/Maven/pmdForMaven');
import ar = require('../../../Tasks/Maven//analysisResult');

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

    it('Maven / PMD: Correct maven goals are applied', (done) => {
        // Arrange
        var mvnRun:trm.ToolRunner = tl.createToolRunner("mvn");

        // Act
        pmd.applyPmdArgs(mvnRun);

        // Assert
        assert(mvnRun.args.length == 2, 'should have only the two expected arguments');
        assert(mvnRun.args.indexOf('jxr:jxr') > -1, 'should have the JXR goal (prerequisite for PMD)');
        assert(mvnRun.args.indexOf('pmd:pmd') > -1, 'should have the PMD goal');
        done();
    });

    it('Maven / PMD: Correct parsing of PMD XML file', (done) => {
        // Arrange
        var testSourceDirectory = path.join(__dirname, 'data');

        // Act
        var exampleResult = pmd.processPmdOutput(testSourceDirectory);

        // Assert
        assert(exampleResult, 'should have returned a non-null result');
        assert(exampleResult.filesWithViolations == 2, 'should have the correct number of files');
        assert(exampleResult.totalViolations == 3, 'should have the correct number of violations');
        assert(exampleResult.xmlFilePath.indexOf(testSourceDirectory) > -1, 'should have a valid xml file path');
        assert(exampleResult.htmlFilePath.indexOf(testSourceDirectory) > -1, 'should have a valid html file path');
        done();
    });

    it('Maven / PMD: Should throw on malformed XML', (done) => {
        // Arrange
        var testDirectory = path.join(__dirname, 'incorrectXmlTest');
        var testTargetPath = path.join(testDirectory, 'target');
        var testSitePath = path.join(testDirectory, 'target', 'site');
        tl.mkdirP(testTargetPath);
        tl.mkdirP(testSitePath);

        // setup test xml file
        var testXmlString = "This isn't proper xml";
        var testXmlFilePath = path.join(testTargetPath, 'pmd.xml');
        fs.writeFileSync(testXmlFilePath, testXmlString);

        // setup dummy html file
        var dummyHtmlFilePath = path.join(testSitePath, 'pmd.html');
        fs.writeFileSync(dummyHtmlFilePath, '');

        // Act
        var exampleResult;
        try {
            exampleResult = pmd.processPmdOutput(testDirectory);

            // Should never reach this line
            assert(false, 'Failed to correctly throw on invalid XML');
        } catch(e) {
            // Assert
            assert(e);

            // cleanup
            tl.rmRF(testDirectory);
            done();
        }
    });

    it('Maven / PMD: Executes PMD goals if PMD is enabled', (done) => {
        // Arrange

        var testStgDir:string = path.join(__dirname, '_temp');
        var testSrcDir:string = path.join(__dirname, 'data');
        tl.rmRF(testStgDir);
        tl.mkdirP(testStgDir);

        // Add test file(s) to the response file so that tl.exist() and tl.checkPath() calls return correctly
        var testXmlFilePath = path.join(testSrcDir, 'target', 'pmd.xml');
        var testHtmlFilePath = path.join(testSrcDir, 'target', 'site', 'pmd.html');
        var responseJsonFilePath:string = path.join(__dirname, 'mavenPmdGood.json');
        var responseJsonContent = JSON.parse(fs.readFileSync(responseJsonFilePath, 'utf-8'));

        responseJsonContent.exist[testXmlFilePath] = true;
        responseJsonContent.exist[testHtmlFilePath] = true;
        responseJsonContent.checkPath[testXmlFilePath] = true;
        responseJsonContent.checkPath[testHtmlFilePath] = true;
        var newResponseFilePath:string = path.join(testStgDir, 'response.json');
        fs.writeFileSync(newResponseFilePath, JSON.stringify(responseJsonContent));

        // Set the newly-changed response file
        setResponseFile(newResponseFilePath);

        // Set up the task runner with the test settings
        var taskRunner:tr.TaskRunner = setupDefaultMavenTaskRunner();
        taskRunner.setInput('pmdAnalysisEnabled', 'true');
        taskRunner.setInput('test.stagingDirectory', testStgDir);
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

                done();
            })
            .fail((err) => {
                done(err);
            });
    });

    it('Maven / PMD: Skips PMD goals if PMD is not enabled', (done) => {
        // Arrange
        setResponseFile(path.join(__dirname, 'mavenGood.json'));

        // Set up the task runner with the test settings
        var taskRunner:tr.TaskRunner = setupDefaultMavenTaskRunner();
        taskRunner.setInput('pmdAnalysisEnabled', 'false');

        // Act
        taskRunner.run()
            .then(() => {
                console.log(taskRunner.stdout);

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
                console.log(taskRunner.stdout);

                // Assert
                assert(taskRunner.resultWasSet, 'should have set a result');
                assert(taskRunner.stdout.length > 0, 'should have written to stdout');
                assert(taskRunner.succeeded, 'task should have succeeded');

                assert(taskRunner.ran('/usr/local/bin/mvn -f pom.xml package jxr:jxr pmd:pmd'),
                    'should have run maven with the correct arguments');
                assert(taskRunner.stdout.indexOf('task.addattachment type=Distributedtask.Core.Summary;name=Code Analysis Report') > -1,
                    'should have uploaded a Code Analysis Report build summary');

                done();
            })
            .fail((err) => {
                console.log(taskRunner.stderr);
                done(err);
            });
    });
});