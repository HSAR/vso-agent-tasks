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

    it('Maven / PMD: Elegant failure on malformed XML', (done) => {
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
        var exampleResult = pmd.processPmdOutput(testDirectory);

        // Assert
        assert(exampleResult);
        assert(exampleResult.xmlFilePath == undefined);
        done();
    });
});