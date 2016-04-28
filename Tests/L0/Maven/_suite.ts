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

// Recursively lists all files within the target folder, giving their full paths.
function listFolderContents(folder):string[] {
    var result:string[] = [];
    var filesInFolder = fs.readdirSync(folder);

    filesInFolder.forEach(function (fileInFolder) {
        result.push(path.join(folder, fileInFolder));
        if (fs.statSync(path.join(folder, fileInFolder)).isDirectory()) {
            result = result.concat(listFolderContents(path.join(folder, fileInFolder)));
        }
    });

    return result;
}

// Adds mock exist, checkPath, rmRF and mkdirP responses for given file paths.
// Takes an object to add to and an array of file paths for which responses should be added.
// Modifies and returns the argument object.
function setupMockResponsesForPaths(responseObject:any, paths: string[]) { // Can't use rest arguments here (gulp-mocha complains)

    // Create empty objects for responses only if they did not already exist (avoid overwriting existing responses)
    responseObject.exist = responseObject.exist || {};
    responseObject.checkPath = responseObject.checkPath || {};
    responseObject.rmRF = responseObject.rmRF || {};
    responseObject.mkdirP = responseObject.mkdirP || {};

    var rmRFSuccessObj = {
        success: true,
        message: "foo bar"
    };


    paths.forEach((path) => {
        responseObject.exist[path] = true;
        responseObject.checkPath[path] = true;
        responseObject.rmRF[path] = rmRFSuccessObj;
        responseObject.mkdirP[path] = true;
    });

    return responseObject;
}

// Asserts the existence of a given line in the build summary file that is uploaded to the server.
function assertBuildSummaryContainsLine(stagingDir:string, expectedLine:string):void {
    var buildSummaryFilePath:string = path.join(stagingDir, '.codeanalysis', 'CodeAnalysisBuildSummary.md');
    var buildSummaryString:string = fs.readFileSync(buildSummaryFilePath, 'utf-8');

    assert(buildSummaryString.indexOf(expectedLine) > -1, "Expected build summary to contain: " + expectedLine);
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
        // In the test data:
        // /: pom.xml, target/.
        // Expected: one module, root.

        // Arrange
        var agentSrcDir:string = path.join(__dirname, 'data', 'singlemodule');
        var agentStgDir:string = path.join(__dirname, '_temp');
        var codeAnalysisStgDir:string = path.join(agentStgDir, '.codeanalysis'); // overall directory for all tools
        var pmdStgDir:string = path.join(codeAnalysisStgDir, '.pmd'); // PMD subdir is used for artifact staging
        var moduleStgDir:string = path.join(pmdStgDir, 'root'); // one and only one module in test data, called root

        tl.rmRF(agentStgDir);

        // Create folders for test
        tl.mkdirP(agentStgDir);
        tl.mkdirP(codeAnalysisStgDir);
        tl.mkdirP(pmdStgDir);
        tl.mkdirP(moduleStgDir);

        // Add set up the response file so that task library filesystem calls return correctly
        // e.g. tl.exist(), tl.checkpath(), tl.rmRF(), tl.mkdirP()
        var testXmlFilePath:string = path.join(agentSrcDir, 'target', 'pmd.xml');
        var testHtmlFilePath:string = path.join(agentSrcDir, 'target', 'site', 'pmd.html');

        var responseJsonFilePath:string = path.join(__dirname, 'mavenPmdGood.json');
        var responseJsonContent = JSON.parse(fs.readFileSync(responseJsonFilePath, 'utf-8'));

        // Add fields corresponding to responses for mock filesystem operations for the following paths
        // Staging directories
        responseJsonContent = setupMockResponsesForPaths(responseJsonContent,
            [testXmlFilePath, testHtmlFilePath, agentStgDir, codeAnalysisStgDir, pmdStgDir, moduleStgDir]);
        // Test data files
        responseJsonContent = setupMockResponsesForPaths(responseJsonContent, listFolderContents(agentSrcDir));

        // Write and set the newly-changed response file
        var newResponseFilePath:string = path.join(agentStgDir, 'response.json');
        fs.writeFileSync(newResponseFilePath, JSON.stringify(responseJsonContent));
        setResponseFile(newResponseFilePath);

        // Set up the task runner with the test settings
        var taskRunner:tr.TaskRunner = setupDefaultMavenTaskRunner();
        taskRunner.setInput('pmdAnalysisEnabled', 'true');
        taskRunner.setInput('test.artifactStagingDirectory', agentStgDir);
        taskRunner.setInput('test.sourcesDirectory', agentSrcDir);

        // Act
        taskRunner.run()
            .then(() => {
                // Assert
                assert(taskRunner.resultWasSet, 'should have set a result');
                assert(taskRunner.stdout.length > 0, 'should have written to stdout');
                assert(taskRunner.succeeded, 'task should have succeeded');

                assert(taskRunner.ran('/usr/local/bin/mvn -f pom.xml package pmd:pmd'),
                    'should have run maven with the correct arguments');
                assert(taskRunner.stdout.indexOf('task.addattachment type=Distributedtask.Core.Summary;name=Code Analysis Report') > -1,
                    'should have uploaded a Code Analysis Report build summary');

                assert(taskRunner.stdout.indexOf('artifact.upload containerfolder=root;artifactname=') > -1,
                    'should have uploaded PMD build artifacts');

                assertBuildSummaryContainsLine(agentStgDir, 'PMD found 3 violations in 2 files.');

                done();
            })
            .fail((err) => {
                console.log(taskRunner.stdout);
                console.log(taskRunner.stderr);
                console.log(err);
                done(err);
            });
    });

    it('Maven / PMD: Detects and uploads results when multiple modules are present', (done) => {
        // In the test data:
        // /: pom.xml, no target/
        // /util/: pom.xml, target/
        // /ignored/: pom.xml, no target/
        // /leveltwo/app/: pom.xml, target/
        // /leveltwo/static/: no pom.xml, target/

        // Arrange
        var agentSrcDir:string = path.join(__dirname, 'data', 'multimodule');
        var agentStgDir:string = path.join(__dirname, '_temp');
        var codeAnalysisStgDir:string = path.join(agentStgDir, '.codeanalysis'); // overall directory for all tools
        var pmdStgDir:string = path.join(codeAnalysisStgDir, '.pmd'); // PMD subdir is used for artifact staging
        var utilStgDir:string = path.join(pmdStgDir, 'util');
        var appStgDir:string = path.join(pmdStgDir, 'leveltwo', 'app'); // two modules in test data, app and util

        tl.rmRF(agentStgDir);

        // Create folders for test
        tl.mkdirP(agentStgDir);
        tl.mkdirP(codeAnalysisStgDir);
        tl.mkdirP(pmdStgDir);
        tl.mkdirP(utilStgDir);
        tl.mkdirP(appStgDir);

        // Add set up the response file so that task library filesystem calls return correctly
        // e.g. tl.exist(), tl.checkpath(), tl.rmRF(), tl.mkdirP()
        var testXmlFilePath:string = path.join(agentSrcDir, 'target', 'pmd.xml');
        var testHtmlFilePath:string = path.join(agentSrcDir, 'target', 'site', 'pmd.html');

        var responseJsonFilePath:string = path.join(__dirname, 'mavenPmdGood.json');
        var responseJsonContent = JSON.parse(fs.readFileSync(responseJsonFilePath, 'utf-8'));

        // Add fields corresponding to responses for mock filesystem operations for the following paths
        // Staging directories
        responseJsonContent = setupMockResponsesForPaths(responseJsonContent,
            [testXmlFilePath, testHtmlFilePath, agentStgDir, codeAnalysisStgDir, pmdStgDir, utilStgDir, appStgDir]);
        // Test data files
        responseJsonContent = setupMockResponsesForPaths(responseJsonContent, listFolderContents(agentSrcDir));

        // Write and set the newly-changed response file
        var newResponseFilePath:string = path.join(agentStgDir, 'response.json');
        fs.writeFileSync(newResponseFilePath, JSON.stringify(responseJsonContent));
        setResponseFile(newResponseFilePath);

        // Set up the task runner with the test settings
        var taskRunner:tr.TaskRunner = setupDefaultMavenTaskRunner();
        taskRunner.setInput('pmdAnalysisEnabled', 'true');
        taskRunner.setInput('test.artifactStagingDirectory', agentStgDir);
        taskRunner.setInput('test.sourcesDirectory', agentSrcDir);

        // Act
        taskRunner.run()
            .then(() => {

                // Assert
                assert(taskRunner.resultWasSet, 'should have set a result');
                assert(taskRunner.stdout.length > 0, 'should have written to stdout');
                assert(taskRunner.succeeded, 'task should have succeeded');

                assert(taskRunner.ran('/usr/local/bin/mvn -f pom.xml package pmd:pmd'),
                    'should have run maven with the correct arguments');
                assert(taskRunner.stdout.indexOf('task.addattachment type=Distributedtask.Core.Summary;name=Code Analysis Report') > -1,
                    'should have uploaded a Code Analysis Report build summary');

                assert(taskRunner.stdout.indexOf('artifact.upload containerfolder=app;artifactname=') > -1,
                    'should have uploaded PMD build artifacts for the "app" module');
                assert(taskRunner.stdout.indexOf('artifact.upload containerfolder=util;artifactname=') > -1,
                    'should have uploaded PMD build artifacts for the "util" module');

                assertBuildSummaryContainsLine(agentStgDir, 'PMD found 6 violations in 4 files.');

                done();
            })
            .fail((err) => {
                console.log(taskRunner.stdout);
                console.log(taskRunner.stderr);
                console.log(err);
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
                console.log(taskRunner.stdout);
                console.log(taskRunner.stderr);
                console.log(err);
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

        responseJsonContent.exist[testStgDir] = true;
        responseJsonContent.exist[testXmlFilePath] = false; // return false for the XML file path
        responseJsonContent.exist[testHtmlFilePath] = true;
        responseJsonContent.checkPath[testStgDir] = true;
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

                assert(taskRunner.ran('/usr/local/bin/mvn -f pom.xml package pmd:pmd'),
                    'should have run maven with the correct arguments');

                done();
            })
            .fail((err) => {
                console.log(taskRunner.stdout);
                console.log(taskRunner.stderr);
                console.log(err);
                done(err);
            });
    });
});