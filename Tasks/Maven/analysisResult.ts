// Data class for return from code analysis tools.
export class AnalysisResult {
    toolName: string;
    filesWithViolations: number;
    totalViolations: number;
    xmlFilePath: string;
    htmlFilePath: string;
}