/// <reference path='../../definitions/vsts-task-lib.d.ts' />

import util = require('util');
import path = require('path');
import fs = require('fs');
import xml2js = require('xml2js');

import tl = require('vsts-task-lib/task');
import trm = require('vsts-task-lib/toolrunner');

import ar = require('./analysisResult');

// Adds PMD goals, if selected by the user
export function applyPmdArgs(mvnRun: trm.ToolRunner):void {
    mvnRun.arg(['jxr:jxr', 'pmd:pmd']); // JXR source code cross-referencing is a required pre-goal for PMD
}

// Extract analysis results from PMD output file.
// Takes the current working directory and returns an AnalysisResult data class.
// Task fails if the HTML or XML outputs were not found.
// @param sourcesDirectory - The absolute location of the root source directory.
export function processPmdOutput(sourcesDirectory:string) : ar.AnalysisResult {
    var result:ar.AnalysisResult = new ar.AnalysisResult();
    result.toolName = 'PMD';

    var pmdXmlFilePath = path.join(sourcesDirectory, '/target/pmd.xml');
    result = processPmdXml(result, pmdXmlFilePath);

    // if there are no violations, there will be no HTML report
    if (result.totalViolations > 0) {
        var pmdHtmlFilePath = path.join(sourcesDirectory, '/target/site/pmd.html');
        result = processPmdHtml(result, pmdHtmlFilePath);
    }

    return result;
}

// Verifies the existence of the HTML output file.
// Modifies the relevant field within the returned object accordingly.
// Task fails if the file cannot be found.
function processPmdHtml(analysisResult:ar.AnalysisResult, path:string):ar.AnalysisResult {
    // Task fails if the file cannot be found.
    if (!tl.exist(path)) {
        tl.error("Could not find PMD HTML output at expected location: " + path);
        tl.error("Check that PMD ran successfully and that it is writing to the default location.");
        tl.exit(1);
    }
    analysisResult.htmlFilePath = path;
    return analysisResult;
}

// Verifies the existence of the XML output file and parses its contents.
// Modifies the relevant fields within the returned object accordingly.
// Task fails if the file cannot be found.
function processPmdXml(analysisResult:ar.AnalysisResult, path:string):ar.AnalysisResult {
    if (!tl.exist(path)) {
        tl.error("Could not find PMD XML output at expected location: " + path);
        tl.error("Check that PMD ran successfully and that it is writing to the default location.");
        tl.exit(1);
    }

    var pmdXmlFileContents = fs.readFileSync(path, 'utf-8');
    xml2js.parseString(pmdXmlFileContents, function (err, data) {
        if (data) {
            analysisResult.xmlFilePath = path;

            analysisResult.filesWithViolations = data.pmd.file.length;
            analysisResult.totalViolations = 0;

            if (analysisResult.filesWithViolations < 1) {
                // Exit quickly if no violations found
                return analysisResult;
            }

            data.pmd.file.forEach(function (file) {
                analysisResult.totalViolations += file.violation.length;
            });
        } else {
            tl.error("Failed to parse XML output from PMD.")
        }
    });
    return analysisResult;
}
