/// <reference path='../../definitions/vsts-task-lib.d.ts' />

import tl = require('vsts-task-lib/task');
import trm = require('vsts-task-lib/toolrunner');

// Adds PMD goals, if selected by the user
export function applyPmdArgs(mvnRun: trm.ToolRunner):void {
    mvnRun.arg(['jxr:jxr', 'pmd:pmd']); // JXR source code cross-referencing is a required pre-goal for PMD
}
