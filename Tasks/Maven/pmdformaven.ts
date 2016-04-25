/// <reference path='../../definitions/vsts-task-lib.d.ts' />

import util = require('util');
import path = require('path');
import fs = require('fs');
import xml2js = require('xml2js');

import tl = require('vsts-task-lib/task');
import trm = require('vsts-task-lib/toolrunner');

import ar = require('./analysisresult');

export const toolName:string = 'PMD';

// Adds PMD goals, if selected by the user
export function applyPmdArgs(mvnRun: trm.ToolRunner):void {
    mvnRun.arg(['pmd:pmd', '-DlinkXRef=false']); // Turn off cross-referencing to reduce Maven error output
}

// Extract analysis results from PMD output file.
// Takes the working directory (should contain pom.xml and target/) and returns an AnalysisResult data class.
// Task fails if the HTML or XML outputs were not found.
// @param sourcesDirectory - The absolute location of the root source directory.
export function processPmdOutput(rootDir:string) : ar.AnalysisResult {
    var result:ar.AnalysisResult = new ar.AnalysisResult();
    result.toolName = toolName;

    var pmdXmlFilePath = path.join(rootDir, 'target', 'pmd.xml');
    result = processPmdXml(result, pmdXmlFilePath);

    // if there are no violations, there will be no HTML report
    if (result.totalViolations > 0) {
        var pmdHtmlFilePath = path.join(rootDir, 'target', 'site', 'pmd.html');
        result = processPmdHtml(result, pmdHtmlFilePath);
    }

    return result;
}

// Verifies the existence of the HTML output file.
// Modifies the relevant field within the returned object accordingly.
function processPmdHtml(analysisResult:ar.AnalysisResult, path:string):ar.AnalysisResult {
    if (!tl.exist(path)) {
        tl.debug('PMD HTML not found at ' + path);
    } else {
        analysisResult.htmlFilePath = path;
    }
    return analysisResult;
}

// Verifies the existence of the XML output file and parses its contents.
// Modifies the relevant fields within the returned object accordingly.
function processPmdXml(analysisResult:ar.AnalysisResult, path:string):ar.AnalysisResult {
    if (!tl.exist(path)) {
        tl.debug('PMD XML not found at ' + path);
    }

    var pmdXmlFileContents = fs.readFileSync(path, 'utf-8');
    xml2js.parseString(pmdXmlFileContents, function (err, data) {
        if (!data) { // Not an XML file, throw error
            throw new Error("Failed to parse XML output from PMD.");
        }
        if (!data.pmd) { // Not a PMD XML, ignore
            return analysisResult;
        }

        analysisResult.xmlFilePath = path;

        if (!data.pmd.file) { // No files with violations, return immediately
            return analysisResult;
        }

        analysisResult.filesWithViolations = data.pmd.file.length;
        var violationsInFile = 0;

        if (analysisResult.filesWithViolations < 1) {
            // Exit quickly if no violations found
            return analysisResult;
        }

        data.pmd.file.forEach(function (file:any) {
            if (file.violation) {
                violationsInFile += file.violation.length;
            }
        });

        analysisResult.totalViolations = violationsInFile;
    });
    return analysisResult;
}
