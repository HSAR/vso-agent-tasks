/// <reference path="../../../definitions/mocha.d.ts"/>
/// <reference path="../../../definitions/node.d.ts"/>
/// <reference path='../../../Tasks/Maven/pmdForMaven.ts'/>

import assert = require('assert');
import path = require('path');

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
        assert(mvnRun.args.length == 2); // should have only the two expected arguments
        assert(mvnRun.args.indexOf('jxr:jxr') > -1); // should have the JXR goal (prerequisite for PMD)
        assert(mvnRun.args.indexOf('pmd:pmd') > -1); // should have the PMD goal
        done();
    });

    it('Maven / PMD: Correct parsing of PMD XML file', (done) => {
        // Arrange
        var testSourceDirectory = path.join(__dirname, 'data');

        // Act
        var exampleResult = pmd.processPmdOutput(testSourceDirectory);

        // Assert
        assert(exampleResult);
        assert(exampleResult.filesWithViolations == 2);
        assert(exampleResult.totalViolations == 3);
        assert(exampleResult.xmlFilePath.indexOf(testSourceDirectory) > -1);
        assert(exampleResult.htmlFilePath.indexOf(testSourceDirectory) > -1);
        done();
    });
});