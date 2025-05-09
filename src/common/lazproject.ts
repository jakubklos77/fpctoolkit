import {
    ConfigurationChangeEvent, Event, EventEmitter, workspace,
    WorkspaceConfiguration, ConfigurationTarget, Uri
} from "vscode";
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import { FpcTaskDefinition, taskProvider } from '../providers/task';
import { CompileOption } from '../languageServer/options';
import { client } from '../extension';

export class LazProjectOptions {

    IncludeFiles: Array<string> = [];
    OtherUnitFiles: Array<string> = [];
    CustomOptions: Array<string> = [];

    SyntaxMode: string = "";
    Target: string = "";
    CWD: string = "";

    MainFile: string = "";
    HostApplication: string = "";
};

class LazProject {

    constructor() {
    }

    private replaceStringWithEnvVar(path: string) {

        // workspace
        if (path.includes('$(ProjOutDir)')) {
            path = path.split('$(ProjOutDir)').join(vscode.workspace.workspaceFolders![0].uri.fsPath);
        }

        // replace environment variable placeholders with actual values
        const envVarRegex = /\$Env\(([^)]+)\)/g;
        path = path.replace(envVarRegex, (_, envVarName) => {
            const envValue = process.env[envVarName];
            if (envValue) {
                return envValue;
            } else {
                vscode.window.showWarningMessage(`Environment variable ${envVarName} is not defined.`);
                return '';
            }
        });

        return path;
    }

    private processOptionStringList(options: Array<string>, split: string, value: string) {

        // replace
        value = this.replaceStringWithEnvVar(value);

        // split path by ";"
        let paths = value.split(split);
        paths.forEach((p) => {
            options.push(p.trim());
        });
    }

    public processFpcOptionStringList(fpcOptions: Array<string>, option: string, options: Array<string>) {

        options.forEach((p) => {
            fpcOptions.push('"' + option + p + '"');
        });
    }

    public LoadProjectOptions(file?: string): LazProjectOptions | null {

        let lazProjectResult: LazProjectOptions | null = null;

        // get project
        let task = this.getProjectFpcTaskDefinition(file);
        if (task && task.file) {
            // check if relative path
            let project = task.file;
            if (!project.startsWith("/")) {
                // expand
                project = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, project);
            }

            // load the project file as xml
            try {
                // chekc if file exists
                if (!fs.existsSync(project))
                    return lazProjectResult;

                const projectContent = fs.readFileSync(project, 'utf-8');
                const parser = new (require('xml2js').Parser)();
                parser.parseString(projectContent, (err: any, result: any) => {
                    if (err) {
                        vscode.window.showErrorMessage("Failed to parse project file as XML: " + err.message);
                        return lazProjectResult;
                    }
                    // Process the parsed XML result
                    if (result?.CONFIG?.CompilerOptions) {

                        lazProjectResult = new LazProjectOptions();

                        this.processOptionStringList(lazProjectResult.IncludeFiles, ";", result.CONFIG.CompilerOptions[0].SearchPaths[0].IncludeFiles[0].$.Value);
                        this.processOptionStringList(lazProjectResult.OtherUnitFiles, ";", result.CONFIG.CompilerOptions[0].SearchPaths[0].OtherUnitFiles[0].$.Value);
                        this.processOptionStringList(lazProjectResult.CustomOptions, "\n", result.CONFIG.CompilerOptions[0].Other[0].CustomOptions[0].$.Value);

                        lazProjectResult.SyntaxMode = result.CONFIG.CompilerOptions[0].Parsing[0].SyntaxOptions[0].SyntaxMode[0].$.Value;
                        lazProjectResult.Target = this.replaceStringWithEnvVar(result.CONFIG.CompilerOptions[0].Target[0].Filename[0].$.Value);
                        lazProjectResult.CWD = path.dirname(lazProjectResult.Target);
                        lazProjectResult.MainFile = path.join(path.dirname(project), result.CONFIG.ProjectOptions[0].Units[0].Unit0[0].Filename[0].$.Value);
                        lazProjectResult.HostApplication = result.CONFIG.ProjectOptions[0].RunParams?.[0].local?.[0].HostApplicationFilename?.[0].$.Value;
                    }
                });
            } catch (error) {
                if (error instanceof Error) {
                    vscode.window.showErrorMessage("Error reading project file: " + error.message);
                } else {
                    vscode.window.showErrorMessage("Error reading project file: " + String(error));
                }
            }
        }

        return lazProjectResult;
    }

    public getProjectFpcTaskDefinition(file?: string): FpcTaskDefinition | null {

        if (!vscode.workspace.workspaceFolders)
            return null;

        // get workspace root
        let workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        // fetch tasks from workspace
        let cfg=vscode.workspace.getConfiguration('tasks', vscode.Uri.file(workspaceRoot));
        let result: FpcTaskDefinition|null = null;
        let is_first=true;
        if (cfg?.tasks != undefined) {
            for (const e of cfg?.tasks) {
                if (e.type === 'fpc') {

                    let match = false;

                    if (file)
                        match = e.file === file;
                    else
                        match = e.group?.isDefault

                    if (match) {

                        // create if default
                        result = new FpcTaskDefinition();
                        result.file = e.file;
                        result.label = e.label;
                        result.launchArgs = e.launchArgs;
                        result.cwd = e.cwd;
                        result.cleanExt = e.cleanExt;
                        result.inherited = e.inherited;
                        result.buildOption = e.buildOption;
                        result.buildEvent = e.buildEvent;
                        return result;
                    }
                }
            }
        }

        return null;
    }

    public GetProjectArgs(): string {

        let task = this.getProjectFpcTaskDefinition();
        return task?.launchArgs ?? '';
    }

    private async runDefaultBuildTask() {

        // Fetch the default build task
        const tasks = await vscode.tasks.fetchTasks({ type: 'fpc' });
        const buildTask = tasks.find(task => task.group?.isDefault === true);
        if (!buildTask)
            return;

        // Create a promise to wait for task completion
        await new Promise<void>(async (resolve, reject) => {
            const taskExecution = await vscode.tasks.executeTask(buildTask);

            // Listen for task end
            const disposable = vscode.tasks.onDidEndTaskProcess(event => {
                if (event.execution === taskExecution) {
                    disposable.dispose(); // Clean up listener
                    if (event.exitCode === 0) {
                        //vscode.window.showInformationMessage("Build completed successfully.");
                        resolve();
                    } else {
                        //vscode.window.showErrorMessage("Build task failed.");
                        //reject(new Error("Build failed"));
                        vscode.commands.executeCommand('workbench.action.debug.stop');
                    }
                }
            });
        });
    }


    private checkAlteredProjectFilesForRebuild(sourceDirs: Array<string>, binaryFile: string): boolean {

        // Check if binary exists
        let binTime = 0;
        try {
            binTime = fs.statSync(binaryFile).mtimeMs;
        } catch (err) {
            return true;
        }

        // Get latest modified source file timestamp
        const getLatestSourceTime = (dir: string): number => {
            let latestTime = 0;
            const files = fs.readdirSync(dir);

            for (const file of files) {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);

                if (stats.isDirectory()) {
                    latestTime = Math.max(latestTime, getLatestSourceTime(filePath));
                } else {
                    latestTime = Math.max(latestTime, stats.mtimeMs);
                }
            }
            return latestTime;
        };

        // process all dirs
        for (const dir of sourceDirs) {
            const srcTime = getLatestSourceTime(dir);

            // if src time recent then return true
            if (srcTime > binTime)
                return true;
        }

        return false;
    }

    public async CheckBeforeBuild() {

        // load
        let project = this.LoadProjectOptions();
        if (!project)
            return;

        // check if project is changed
        let rebuild = this.checkAlteredProjectFilesForRebuild(project.IncludeFiles, project.Target);
        rebuild = rebuild || this.checkAlteredProjectFilesForRebuild(project.OtherUnitFiles, project.Target);

        // rebuild and wait
        if (rebuild)
            await this.runDefaultBuildTask();
    }

    public async promptToSaveAllIfDirty(): Promise<boolean> {
        const dirtyEditors = vscode.workspace.textDocuments.filter(doc => doc.isDirty);
        if (dirtyEditors.length > 0) {
            const save = await vscode.window.showWarningMessage(
                'There are unsaved files. Do you want to save all before switching projects?',
                { modal: true },
                'Save All', 'Cancel'
            );
            if (save === 'Save All') {
                await vscode.workspace.saveAll();
                return true;
            }
            return false;
        }
        return true;
    }

    public async saveEditorStateByKey(key: string, context: vscode.ExtensionContext) {

        const allTabs = ([] as vscode.Tab[]).concat(...vscode.window.tabGroups.all.map(group => group.tabs));
        const activeTab = allTabs.find(tab => tab.isActive);

        const state = allTabs.map(tab => {
            let uri: string | undefined;
            if (tab.input && (tab.input as any).uri) {
                uri = (tab.input as any).uri.toString();
            }
            if (!uri)
                return undefined;

            // Try to find a visible editor for this tab
            const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri);
            return {
                uri,
                selection: editor ? {
                    start: editor.selection.start,
                    end: editor.selection.end
                } : undefined,
                visibleRange: editor && editor.visibleRanges[0] ? {
                    start: editor.visibleRanges[0].start,
                    end: editor.visibleRanges[0].end
                } : undefined,
                isActive: activeTab && uri === ((activeTab.input as any)?.uri?.toString())
            };
        }).filter(Boolean);
        await context.globalState.update(`editorState:${key}`, state);
    }

    public async restoreEditorStateByKey(key: string, context: vscode.ExtensionContext) {
        const state = context.globalState.get<any[]>(`editorState:${key}`);
        if (!state)
            return;

        // Close all open editors
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        let activeToRestore: any = undefined;

        for (const entry of state) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(entry.uri));
            const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: !entry.isActive });
            if (entry.selection) {
                editor.selection = new vscode.Selection(
                    new vscode.Position(entry.selection.start.line, entry.selection.start.character),
                    new vscode.Position(entry.selection.end.line, entry.selection.end.character)
                );
            }
            if (entry.visibleRange) {
                editor.revealRange(
                    new vscode.Range(
                        new vscode.Position(entry.visibleRange.start.line, entry.visibleRange.start.character),
                        new vscode.Position(entry.visibleRange.end.line, entry.visibleRange.end.character)
                    ),
                    vscode.TextEditorRevealType.AtTop
                );
            }
            if (entry.isActive) {
                activeToRestore = editor;
            }
        }

        // Ensure the active editor is focused
        if (activeToRestore) {
            await vscode.window.showTextDocument(activeToRestore.document, { preview: false, preserveFocus: false });
        }
    }

    public async ProjectActivate(workspaceRoot: string, file: string, label: string, context: vscode.ExtensionContext) {

        // Prompt to save all if dirty
        if (!(await this.promptToSaveAllIfDirty())) {
            return;
        }

        // Save editor state for the current project
        let task = this.getProjectFpcTaskDefinition();
        if (task && task.file)
            await this.saveEditorStateByKey(task.file, context);

        // get tasks
        let matched = false;
        let config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(workspaceRoot));
        let tasks = config.tasks;
        for (const task of tasks) {

            // match our task
            let match = true;
            if (label) {
                match = task.label === label;
            }

            if (task.file === file && match && !matched) {
                if (typeof (task.group) === 'object') {
                    task.group.isDefault = true;
                } else {
                    task.group = { kind: task.group, isDefault: true };
                }

                matched = true;

                // all other tasks - reset
            } else {
                if (typeof (task.group) === 'object') {
                    task.group.isDefault = undefined;
                }
            }
        }

        // update tasks
        await config.update(
            "tasks",
            tasks,
            vscode.ConfigurationTarget.WorkspaceFolder
        );

        // reload tasks
        vscode.commands.executeCommand('workbench.action.tasks.reloadTasks');

        // restart LSP
        client.restart();

        // Restore editor state if exists
        await this.restoreEditorStateByKey(file, context);
    }
}

export const lazproject = new LazProject();