/// <reference path="./vsts-task-lib.d.ts" />

declare module 'sonarqube-common/sonarqube-common' {
    import trm = require('vsts-task-lib/toolrunner');

    // Apply appropriate -Dkey=value parameters for the given argument values.
    export function applySonarQubeParams(toolRunner:trm.ToolRunner, sqHostUrl, sqHostUsername, sqHostPassword, sqDbUrl?, sqDbUsername?, sqDbPassword?):trm.ToolRunner;

    // Data class returned from getSonarQubeEndpointDetails()
    export class SonarQubeEndpoint {
        constructor(Url, Username, Password);

        Url: string;
        Username: string;
        Password: string;
    }

    // Fetches configured SonarQube endpoint details.
    export function getSonarQubeEndpointDetails(inputFieldName):SonarQubeEndpoint;
}