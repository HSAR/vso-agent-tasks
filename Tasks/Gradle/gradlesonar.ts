/// <reference path="../../definitions/vsts-task-lib.d.ts" />
/// <reference path="../../definitions/sonarqube-common.d.ts" />

import path = require('path');

import tl = require('vsts-task-lib/task');
import trm = require('vsts-task-lib/toolrunner');

// Lowercased file names are to lessen the likelihood of xplat issues
import sqCommon = require('sonarqube-common/sonarqube-common');

// Apply arguments to enable SonarQube analysis
export function applyEnabledSonarQubeArguments(gradleRun: trm.ToolRunner):trm.ToolRunner {
    if (!tl.getBoolInput('sqAnalysisEnabled')) {
        console.log("SonarQube analysis is not enabled");
        return gradleRun;
    }

    console.log("SonarQube analysis is enabled");

    var sourcesDir = tl.getVariable('build.sourcesDirectory');
    var sqEndpoint:sqCommon.SonarQubeEndpoint = sqCommon.getSonarQubeEndpointDetails("sqConnectedServiceName");

    // SQ servers lower than 5.2 require additional parameters (null if not set / not required)
    var sqDbUrl = tl.getInput('sqDbUrl', false);
    var sqDbUsername = tl.getInput('sqDbUsername', false);
    var sqDbPassword = tl.getInput('sqDbPassword', false);
    gradleRun = sqCommon.applySonarQubeParams(gradleRun, sqEndpoint.Url, sqEndpoint.Username, sqEndpoint.Password, sqDbUrl, sqDbUsername, sqDbPassword);

    // Copy an initialisation script that will inject the SonarQube plugin into the build
    var initScriptSource:string = path.join(__dirname, 'sonar.gradle');
    var initScriptDest:string = path.join(sourcesDir, 'sonar.gradle');

    // -f overwrites if there is already a file at the destination
    tl.cp('-f', initScriptSource, initScriptDest);

    // Add an init-script to inject the SonarQube plugin and add the associated SonarQube analysis task
    gradleRun.arg(['-I', './sonar.gradle']);
    gradleRun.arg(['sonarqube']);

    return gradleRun;
}