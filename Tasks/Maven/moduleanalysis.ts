import ar = require('./analysisresult');
// Data class for supporting Maven projects with more than one module
export class ModuleAnalysis {
    moduleName: string;
    rootFolder: string;
    analysisResults:any = {}; // To be used as a dictionary
}