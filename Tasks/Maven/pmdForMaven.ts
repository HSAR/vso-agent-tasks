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
// @param sourcesDirectory - The absolute location of the root source directory.
// @param overrideFolder - (Optional) If true, look only in the location specified by the first argument.
export function processPmdOutput(sourcesDirectory:string) : ar.AnalysisResult {
    var result:ar.AnalysisResult = new ar.AnalysisResult();
    result.toolName = 'PMD';

    // Verify the existence of pmd.html file - it is also written to a well-known location
    var pmdHtmlFilePath = path.join(sourcesDirectory, '/target/site/pmd.html');
    tl.checkPath(pmdHtmlFilePath, "./target/site/pmd.html");
    result.htmlFilePath = pmdHtmlFilePath;

    // Request pmd.xml file for reading - it is written to a well-known location
    var pmdXmlFilePath = path.join(sourcesDirectory, '/target/pmd.xml');
    tl.checkPath(pmdXmlFilePath, "./target/pmd.xml");
    var pmdXmlFileContents = fs.readFileSync(pmdXmlFilePath, 'utf-8');
    xml2js.parseString(pmdXmlFileContents, function (err, data) {
        if (data) {
            result.xmlFilePath = pmdXmlFilePath;
        }

        result.filesWithViolations = data.pmd.file.length;
        result.totalViolations = 0;

        if (result.filesWithViolations < 1) {
            // Exit quickly if no violations found
            return result
        }

        data.pmd.file.forEach(function (file) {
            result.totalViolations += file.violation.length;
        });

    });
    return result;
}
