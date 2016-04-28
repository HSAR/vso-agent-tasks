/// <reference path="../../definitions/vsts-task-lib.d.ts" />
/// <reference path="../../definitions/Q.d.ts" />

import path = require('path');
import fs = require('fs');

import tl = require('vsts-task-lib/task');
import trm = require('vsts-task-lib/toolrunner');
import Q = require('q');

// Lowercased names are to lessen the likelihood of xplat issues
import pmd = require('./pmdformaven');
import ar = require('./analysisresult');
import ma = require('./moduleanalysis');

// Set up for localization
tl.setResourcePath(path.join( __dirname, 'task.json'));

// Cache build variables - if they are null, we are in a test env and can use test inputs
// The artifact staging directory will be a subdirectory just to be safe.
var sourcesDir:string = tl.getVariable('build.sourcesDirectory') || tl.getInput('test.sourcesDirectory');
var stagingDir:string = path.join(tl.getVariable('build.artifactStagingDirectory') || tl.getInput('test.artifactStagingDirectory'), ".codeanalysis");
var buildNumber:string = tl.getVariable('build.buildNumber') || tl.getInput('test.buildNumber');

var mvntool = '';
var mavenVersionSelection = tl.getInput('mavenVersionSelection', true);
if (mavenVersionSelection == 'Path') {
    tl.debug('Using maven path from user input');
    var mavenPath = tl.getPathInput('mavenPath', true, true);
    mvntool = path.join(mavenPath, 'bin/mvn');

    if (tl.getBoolInput('mavenSetM2Home')) {
        tl.setEnvVar("M2_HOME", mavenPath);
        tl.debug('M2_HOME set to ' + mavenPath)
    }
} else {
    tl.debug('Using maven from standard system path');
    mvntool = tl.which('mvn', true);
}
tl.debug('Maven binary: ' + mvntool);

var mavenPOMFile = tl.getPathInput('mavenPOMFile', true, true);
var mavenOptions = tl.getInput('options', false); // options can have spaces and quotes so we need to treat this as one string and not try to parse it
var mavenGoals = tl.getDelimitedInput('goals', ' ', true); // This assumes that goals cannot contain spaces

var mvnv = tl.createToolRunner(mvntool);
mvnv.arg('-version');

var mvnb = tl.createToolRunner(mvntool);
mvnb.arg('-f');
mvnb.pathArg(mavenPOMFile);
mvnb.argString(mavenOptions);
mvnb.arg(mavenGoals);

// update JAVA_HOME if user selected specific JDK version or set path manually
var javaHomeSelection = tl.getInput('javaHomeSelection', true);
var specifiedJavaHome = null;

if (javaHomeSelection == 'JDKVersion') {
    tl.debug('Using JDK version to find and set JAVA_HOME');
    var jdkVersion = tl.getInput('jdkVersion');
    var jdkArchitecture = tl.getInput('jdkArchitecture');

    if (jdkVersion != 'default') {
        // jdkVersion should be in the form of 1.7, 1.8, or 1.10
        // jdkArchitecture is either x64 or x86
        // envName for version 1.7 and x64 would be "JAVA_HOME_7_X64"
        var envName = "JAVA_HOME_" + jdkVersion.slice(2) + "_" + jdkArchitecture.toUpperCase();
        specifiedJavaHome = tl.getVariable(envName);
        if (!specifiedJavaHome) {
            tl.error('Failed to find specified JDK version. Please make sure environment variable ' + envName + ' exists and is set to the location of a corresponding JDK.');
            tl.exit(1);
        }
    }
} else {
    tl.debug('Using path from user input to set JAVA_HOME');
    var jdkUserInputPath = tl.getPathInput('jdkUserInputPath', true, true);
    specifiedJavaHome = jdkUserInputPath;
}

if (specifiedJavaHome) {
    tl.debug('Set JAVA_HOME to ' + specifiedJavaHome);
    process.env['JAVA_HOME'] = specifiedJavaHome;
}

var publishJUnitResults = tl.getInput('publishJUnitResults');
var testResultsFiles = tl.getInput('testResultsFiles', true);

function publishTestResults(publishJUnitResults, testResultsFiles: string) {
    var matchingTestResultsFiles: string[] = undefined;
    if (publishJUnitResults == 'true') {
        //check for pattern in testResultsFiles
        if (testResultsFiles.indexOf('*') >= 0 || testResultsFiles.indexOf('?') >= 0) {
            tl.debug('Pattern found in testResultsFiles parameter');
            var buildFolder = tl.getVariable('agent.buildDirectory');
            tl.debug(`buildFolder=${buildFolder}`);
            var allFiles = tl.find(buildFolder);
            matchingTestResultsFiles = tl.match(allFiles, testResultsFiles, {
                matchBase: true
            });
        } else {
            tl.debug('No pattern found in testResultsFiles parameter');
            matchingTestResultsFiles = [testResultsFiles];
        }

        if (!matchingTestResultsFiles || matchingTestResultsFiles.length == 0) {
            tl.warning('No test result files matching ' + testResultsFiles + ' were found, so publishing JUnit test results is being skipped.');
            return 0;
        }
        
        var tp = new tl.TestPublisher("JUnit");
        tp.publish(matchingTestResultsFiles, true, "", "", "", true);
    }
}

function getSonarQubeRunner() {
    if (!tl.getBoolInput('sqAnalysisEnabled')) {
        console.log("SonarQube analysis is not enabled");
        return;
    }

    console.log("SonarQube analysis is enabled");
    var mvnsq;
    var sqEndpoint = getEndpointDetails("sqConnectedServiceName");

    if (tl.getBoolInput('sqDbDetailsRequired')) {
        var sqDbUrl = tl.getInput('sqDbUrl', false);
        var sqDbUsername = tl.getInput('sqDbUsername', false);
        var sqDbPassword = tl.getInput('sqDbPassword', false);
        mvnsq = createMavenSQRunner(sqEndpoint.Url, sqEndpoint.Username, sqEndpoint.Password, sqDbUrl, sqDbUsername, sqDbPassword);
    } else {
        mvnsq = createMavenSQRunner(sqEndpoint.Url, sqEndpoint.Username, sqEndpoint.Password);
    }

    mvnsq.arg('-f');
    mvnsq.pathArg(mavenPOMFile);
    mvnsq.argString(mavenOptions); // add the user options to allow further customization of the SQ run
    mvnsq.arg("sonar:sonar");

    return mvnsq;
}

function getEndpointDetails(inputFieldName) {
    var errorMessage = "Could not decode the generic endpoint. Please ensure you are running the latest agent (min version 0.3.2)"
    if (!tl.getEndpointUrl) {
        throw new Error(errorMessage);
    }

    var genericEndpoint = tl.getInput(inputFieldName);
    if (!genericEndpoint) {
        throw new Error(errorMessage);
    }

    var hostUrl = tl.getEndpointUrl(genericEndpoint, false);
    if (!hostUrl) {
        throw new Error(errorMessage);
    }

    // Currently the username and the password are required, but in the future they will not be mandatory
    // - so not validating the values here
    var hostUsername = getAuthParameter(genericEndpoint, 'username');
    var hostPassword = getAuthParameter(genericEndpoint, 'password');
    tl.debug("hostUsername: " + hostUsername);

    return {
        "Url": hostUrl,
        "Username": hostUsername,
        "Password": hostPassword
    };
}

// The endpoint stores the auth details as JSON. Unfortunately the structure of the JSON has changed through time, namely the keys were sometimes upper-case.
// To work around this, we can perform case insensitive checks in the property dictionary of the object. Note that the PowerShell implementation does not suffer from this problem.
// See https://github.com/Microsoft/vso-agent/blob/bbabbcab3f96ef0cfdbae5ef8237f9832bef5e9a/src/agent/plugins/release/artifact/jenkinsArtifact.ts for a similar implementation
function getAuthParameter(endpoint, paramName) {

    var paramValue = null;
    var auth = tl.getEndpointAuthorization(endpoint, false);

    if (auth.scheme != "UsernamePassword") {
        throw new Error("The authorization scheme " + auth.scheme + " is not supported for a SonarQube endpoint. Please use a username and a password.");
    }

    var parameters = Object.getOwnPropertyNames(auth['parameters']);

    var keyName;
    parameters.some(function (key) {

        if (key.toLowerCase() === paramName.toLowerCase()) {
            keyName = key;

            return true;
        }
    });

    paramValue = auth['parameters'][keyName];

    return paramValue;
}

function createMavenSQRunner(sqHostUrl, sqHostUsername, sqHostPassword, sqDbUrl?, sqDbUsername?, sqDbPassword?) {
    var mvnsq = tl.createToolRunner(mvntool);

    mvnsq.arg('-Dsonar.host.url=' + sqHostUrl);
    if (sqHostUsername) {
        mvnsq.arg('-Dsonar.login=' + sqHostUsername);
    }
    if (sqHostPassword) {
        mvnsq.arg('-Dsonar.password=' + sqHostPassword);
    }
    if (sqDbUrl) {
        mvnsq.arg('-Dsonar.jdbc.url=' + sqDbUrl);
    }
    if (sqDbUsername) {
        mvnsq.arg('-Dsonar.jdbc.username=' + sqDbUsername);
    }
    if (sqDbPassword) {
        mvnsq.arg('-Dsonar.jdbc.password=' + sqDbPassword);
    }

    return mvnsq;
}

function processMavenOutput(data) {
    if(data == null) {
        return;
    }

    data = data.toString();
    var input = data;
    var severity = 'NONE';
    if(data.charAt(0) === '[') {
        var rightIndex = data.indexOf(']');
        if(rightIndex > 0) {
            severity = data.substring(1, rightIndex);

            if(severity === 'ERROR' || severity === 'WARNING') {
                // Try to match output like
                // /Users/user/agent/_work/4/s/project/src/main/java/com/contoso/billingservice/file.java:[linenumber, columnnumber] error message here
                // A successful match will return an array of 5 strings - full matched string, file path, line number, column number, error message
                input = input.substring(rightIndex + 1);
                var compileErrorsRegex = /([a-zA-Z0-9_ \-\/.]+):\[([0-9]+),([0-9]+)\](.*)/g;
                var matches = [];
                var match;
                while (match = compileErrorsRegex.exec(input.toString())) {
                    matches = matches.concat(match);
                }

                if(matches != null) {
                    var index = 0;
                    while (index + 4 < matches.length) {
                        tl.debug('full match = ' + matches[index + 0]);
                        tl.debug('file path = ' + matches[index + 1]);
                        tl.debug('line number = ' + matches[index + 2]);
                        tl.debug('column number = ' + matches[index + 3]);
                        tl.debug('message = ' + matches[index + 4]);

                        // task.issue is only for xplat agent and doesn't provide the sourcepath link on summary page
                        // we should use task.logissue when xplat agent is not used anymore so this will workon the coreCLR agent
                        tl.command('task.issue', {
                            type: severity.toLowerCase(),
                            sourcepath: matches[index + 1],
                            linenumber: matches[index + 2],
                            columnnumber: matches[index + 3]
                        }, matches[index + 0]);

                        index = index + 5;
                    }
                }
            }
        }
    }
}

// Identifies maven modules below the root by the presence of a pom.xml file and a /target/ directory,
// which is the conventional format of a Maven module.
// There is a possibility of both false positives if the above two factors are identified in a directory
// that is not an actual Maven module, or if the module is not currently being built.
// The possibility of false positives should be taken into account when this method is called.
function findCandidateModules(directory:string):ma.ModuleAnalysis[] {
    var result:ma.ModuleAnalysis[] = [];
    var filesInDirectory:string[] = fs.readdirSync(directory);

    // Look for pom.xml and /target/
    if ((filesInDirectory.indexOf('pom.xml') > -1) && (filesInDirectory.indexOf('target') > -1)) {
        var newModule:ma.ModuleAnalysis = new ma.ModuleAnalysis();
        newModule.moduleName = path.basename(directory);
        newModule.rootDirectory = directory;
        result.push(newModule);
    }

    // Search subdirectories
    filesInDirectory.forEach(function(fileInDirectory:string) {
        if (fs.statSync(path.join(directory, fileInDirectory)).isDirectory()) {
            result = result.concat(findCandidateModules(path.join(directory, fileInDirectory)));
        }
    });

    return result;
}

// check for and, if appropriate, add PMD analysis goals
function applyPmdGoals(mvnRun: trm.ToolRunner):void {
    if (tl.getInput('pmdAnalysisEnabled', true) != 'true') {
        console.log('PMD analysis is not enabled');
        return;
    }
    console.log('PMD analysis is enabled');
    pmd.applyPmdArgs(mvnb);
}

// Returns the names of any enabled code analysis tools, or empty array if none.
function getEnabledCodeAnalysisTools():string[] {
    var result:string[] = [];

    if (tl.getInput('pmdAnalysisEnabled', true) == 'true') {
        result.push(pmd.toolName);
    }

    return result;
}

function cleanDirectory(targetDirectory:string):boolean {
    tl.rmRF(targetDirectory);
    tl.mkdirP(targetDirectory);

    return tl.exist(targetDirectory);
}

// Returns the full path of the staging directory for a given tool.
function getStagingDirectory(toolName:string):string {
    return path.join(stagingDir, toolName.toLowerCase());
}

// Copy output files to a staging directory and upload them as build artifacts.
// Each tool-module combination uploads its own build artifact.
function uploadBuildArtifacts(toolName:string, moduleAnalysis:ma.ModuleAnalysis):void {
    // The staging directory is used as a place to copy files before group uploading them, and was originally
    // related to the following bug: https://github.com/Microsoft/vso-agent/issues/263
    var localStagingDir:string = path.join(getStagingDirectory(toolName), moduleAnalysis.moduleName);
    tl.mkdirP(localStagingDir);

    var filesToUpload:string[] = [];
    if (moduleAnalysis.analysisResults[toolName]) {
        filesToUpload = moduleAnalysis.analysisResults[toolName].filesToUpload;
    }

    if (filesToUpload.length < 1) {
        console.log('No artifacts to upload for ' + toolName + ' analysis of module ' + moduleAnalysis.moduleName);
        return;
    }

    // Copy files to a staging directory so that they can all be uploaded at once
    // This gives us a single artifact with all relevant files grouped together,
    // giving a more organised experience in the artifact explorer.
    filesToUpload.forEach((fileToUpload:string) => {
        var stagingFilePath = path.join(localStagingDir, path.basename(fileToUpload));
        tl.debug('Staging ' + fileToUpload + ' to ' + stagingFilePath);
        // Execute the copy operation. -f overwrites if there is already a file at the destination.
        tl.cp('-f', fileToUpload, stagingFilePath);
    });

    console.log('Uploading artifacts for ' + toolName + ' from ' + localStagingDir);

    // Begin artifact upload - this is an asynchronous operation and will finish in the future
    tl.command("artifact.upload", {
        // Put the artifacts in subdirectories corresponding to their module
        containerfolder: moduleAnalysis.moduleName,
        // Prefix the build number onto the upload for convenience
        // NB: Artifact names need to be unique on an upload-by-upload basis
        artifactname: buildNumber + '_' + moduleAnalysis.moduleName + '_' + toolName
    }, localStagingDir);
}

// Extract data from code analysis output files and upload results to build server
function uploadCodeAnalysisResults():void {
    // Need to run this if any one of the code analysis tools were run
    var enabledCodeAnalysisTools = getEnabledCodeAnalysisTools();
    if (enabledCodeAnalysisTools.length > 0) {
        // Discover maven modules
        var modules:ma.ModuleAnalysis[] = findCandidateModules(sourcesDir);

        // Special case: if the root turns up as a module, the automatic name won't do
        modules.forEach((module:ma.ModuleAnalysis) => {
            if (module.rootDirectory == sourcesDir) {
                module.moduleName = 'root';
            }
        });

        tl.debug('Discovered ' + modules.length + ' Maven modules to upload results from.');

        // Discover output files, summarise per-module results
        modules.forEach((module:ma.ModuleAnalysis) => {
            // PMD
            if (enabledCodeAnalysisTools.indexOf(pmd.toolName) > -1) {
                try {
                    var pmdResults:ar.AnalysisResult = pmd.collectPmdOutput(module.rootDirectory);
                    if (pmdResults) {
                        module.analysisResults[pmdResults.toolName] = pmdResults;
                    }
                } catch(e) {
                    tl.error(e.message);
                    tl.exit(1);
                }
            }

        });


        // Gather analysis results by tool for summaries, stage and upload build artifacts
        var buildSummaryLines:string[] = [];
        cleanDirectory(stagingDir);

        enabledCodeAnalysisTools.forEach((toolName:string) => {
            var toolAnalysisResults:ar.AnalysisResult[] = [];
            modules.forEach((module:ma.ModuleAnalysis) => {
                var moduleAnalysisResult:ar.AnalysisResult = module.analysisResults[toolName];
                if (moduleAnalysisResult) {
                    toolAnalysisResults.push(moduleAnalysisResult);
                }

                uploadBuildArtifacts(toolName, module);
            });

            // After looping through all modules, summarise tool output results
            try {
                var summaryLine:string = createSummaryLine(toolName, toolAnalysisResults);
            } catch (error) {
                tl.error(error.message);
            }
            buildSummaryLines.push(summaryLine);
        });

        // Save and upload build summary
        // Looks like: "PMD found 13 violations in 4 files.  \r\n
        // FindBugs found 10 violations in 8 files."
        var buildSummaryContents:string = buildSummaryLines.join("  \r\n"); // Double space is end of line in markdown
        var buildSummaryFilePath:string = path.join(stagingDir, 'CodeAnalysisBuildSummary.md');
        fs.writeFileSync(buildSummaryFilePath, buildSummaryContents);
        tl.debug('Uploading build summary from ' + buildSummaryFilePath);

        tl.command('task.addattachment', {
            'type': 'Distributedtask.Core.Summary',
            'name': "Code Analysis Report"
        }, buildSummaryFilePath);
    }
}

// For a given code analysis tool, create a one-line summary from multiple AnalysisResult objects.
function createSummaryLine(toolName:string, analysisResults:ar.AnalysisResult[]):string {
    var totalViolations:number = 0;
    var filesWithViolations:number = 0;
    analysisResults.forEach((analysisResult:ar.AnalysisResult) => {
        if (toolName = analysisResult.toolName) {
            totalViolations += analysisResult.totalViolations;
            filesWithViolations += analysisResult.filesWithViolations;
        }
    });
    // Localize and inject appropriate parameters
    if (totalViolations > 1) {
        if (filesWithViolations > 1) {
            // Looks like: 'PMD found 13 violations in 4 files.'
            return tl.loc('codeAnalysisBuildSummaryLine_SomeViolationsSomeFiles', toolName, totalViolations, filesWithViolations);
        }
        if (filesWithViolations == 1) {
            // Looks like: 'PMD found 13 violations in 1 file.'
            return tl.loc('codeAnalysisBuildSummaryLine_SomeViolationsOneFile', toolName, totalViolations);
        }
    }
    if (totalViolations == 1 && filesWithViolations == 1) {
            // Looks like: 'PMD found 1 violation in 1 file.'
            return tl.loc('codeAnalysisBuildSummaryLine_OneViolationOneFile', toolName);
    }
    if (totalViolations == 0) {
        // Looks like: 'PMD found no violations.'
        return tl.loc('codeAnalysisBuildSummaryLine_NoViolations', toolName);
    }
    // There should be no valid code reason to reach this point - '1 violation in 4 files' is not expected
    throw new Error('Unexpected results from ' + toolName + ': '
        + totalViolations + 'total violations in ' + filesWithViolations + ' files');
}

/*
Maven task orchestration:
1. Check that maven exists
2. Run maven with the user goals. Compilation or test errors will cause this to fail
3. Always try to publish tests results
4. Always try to run the SonarQube analysis if it is enabled. In case the build has failed, the analysis
will still succeed but the report will have less data.
5. Check the maven run completed, which is an indication that the code analysis tools were run successfully.
Process and upload any relevant results and summaries.
6. If #2, #4 or #5 failed, exit with an error code to mark the entire step as failed.
*/

var userRunFailed = false;
var sqRunFailed = false;
var pmdRunFailed:boolean = false;

mvnv.exec()
.fail(function (err) {
    console.error("Maven is not installed on the agent");
    tl.exit(1);  // tl.exit sets the step result but does not stop execution
    process.exit(1);
})
.then(function (code) {
    applyPmdGoals(mvnb);
        //read maven stdout
        mvnb.on('stdout', function (data) {
            processMavenOutput(data);
        });
    return mvnb.exec(); // run Maven with the user specified goals
})
.fail(function (err) {
    console.error(err.message);
    userRunFailed = true; // record the error and continue
})
.then(function (code) {
    var mvnsq = getSonarQubeRunner();

    if (mvnsq) {
        // run Maven with the sonar:sonar goal, even if the user-goal Maven failed (e.g. test failures)
        // note that running sonar:sonar along with the user goals is not supported due to a SonarQube bug
        return mvnsq.exec()
    }
})
.fail(function (err) {
    console.error(err.message);
    console.error("SonarQube analysis failed");
    sqRunFailed = true;
})
.then(function (code) { // Pick up files from the Java code analysis tools
    // The files won't be created if the build failed, and the user should probably fix their build first
    if (userRunFailed) {
        console.error('Could not retrieve code analysis results - Maven run failed.');
        return;
    }

    uploadCodeAnalysisResults();
})
.fail(function (err) {
    console.error(err.message);
    console.error("PMD analysis failed");
    pmdRunFailed = true;
})
.then(function () {
    // publish test results even if tests fail, causing Maven to fail;
    publishTestResults(publishJUnitResults, testResultsFiles);
    if (userRunFailed || sqRunFailed || pmdRunFailed) {
        tl.exit(1); // mark task failure
    } else {
        tl.exit(0); // mark task success
    }

    // do not force an exit as publishing results is async and it won't have finished
})
