import * as vscode from 'vscode';
import { FpcItem } from './providers/project';
import * as fs from 'fs';
import * as fs2 from 'fs-extra';
import path = require('path');
import { BuildMode, FpcTask, FpcTaskDefinition, FpcTaskProvider, taskProvider } from './providers/task';
import { CompileOption } from './languageServer/options';
import { configuration } from './common/configuration'
import { lazproject } from './common/lazproject'
import { type } from 'os';
import { EditorCommandManager } from './editor';
import { client } from './extension';
import { TextEditor, TextEditorEdit } from 'vscode';


export class FpcCommandManager {

    constructor(private workspaceRoot: string) {

    }
    registerAll(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.project.build', this.ProjectBuild));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.project.rebuild', this.ProjectReBuild));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.project.clean', this.ProjectClean));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.project.opensetting', this.ProjectOpen));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.project.newproject', this.ProjectNew));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.project.add', this.ProjectAdd));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.project.setdefault', this.ProjectSetDefault));

        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.currentproject.activate', this.ProjectActivate));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.currentproject.cwd', this.GetCWD));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.currentproject.program', this.GetProgram));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.currentproject.checkforrebuild', this.CheckForRebuild));
        context.subscriptions.push(vscode.commands.registerCommand('fpctoolkit.currentproject.launchargs', this.GetLaunchArgs));

        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.code.complete',this.CodeComplete));

        // General commands
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.code.rename',this.CodeRename));

        // Register commands
        let commands = new EditorCommandManager();
        commands.registerAll(context);
    }
    ProjectAdd = async (node: FpcItem) => {
        if (node.level === 0) {
            let config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot));
            let inp = await vscode.window.showQuickPick(['debug', 'release', 'other...'], { canPickMany: false });
            if (!inp) {
                return;
            }
            let label: string | undefined;
            let customOption = '-dDEBUG';
            let isDebug=false;
            switch (inp) {
                case 'debug':
                    isDebug=true;
                    label = 'debug';
                    break;
                case 'release':
                    label = 'release';
                    customOption = '-dRELEASE';
                    break;

                default:
                    label = await vscode.window.showInputBox({ prompt: 'Input build label:' });

                    break;
            }
            if (!label) {
                return;
            }
            let v = {
                "label": label,
                "file": node.label,
                "type": "fpc",
                "buildOption": {
                    "syntaxMode": "ObjFPC",
                    "unitOutputDir": "./out",
                    "customOptions": [
                        customOption
                    ]
                }
            };
            if(isDebug){
                v.buildOption.customOptions=[customOption,'-gw2'];
            }

            let tasks = config.tasks;
            if (tasks) {
                tasks.push(v);
            } else {
                tasks = [v];
            }
            config.update(
                "tasks",
                tasks,
                vscode.ConfigurationTarget.WorkspaceFolder
            );
        }

    };
    ProjectBuildInternal = async (node: FpcItem, rebuild: boolean = false) => {

        // Get task label
        let taskLabel = '';

        // Node known
        if (node) {
            taskLabel = node.label;

        // No node - use the current project
        } else {
            let task = lazproject.getDefaultProjectFpcTaskDefinition();
            if (task)
                taskLabel = task.label;
        }

        vscode.tasks.fetchTasks({ type: 'fpc' }).then((e) => {
            e.forEach((task) => {
                if (task.name === taskLabel) {
                    let newtask=taskProvider.taskMap.get(task.name);
                    if(newtask){
                        if (!node?.forceRebuild && !rebuild) {
                            (newtask as FpcTask).BuildMode=BuildMode.normal;
                        } else {
                            (newtask as FpcTask).BuildMode=BuildMode.rebuild;
                        }
                    }
                    vscode.tasks.executeTask(task);

                    return;
                }

            });
        });

    };
    ProjectBuild = async (node: FpcItem) => {

        this.ProjectBuildInternal(node);

    };
    ProjectReBuild = async (node: FpcItem) => {

        this.ProjectBuildInternal(node, true);

    };
    ProjectOpen = async (node?: FpcItem) => {

        let file = path.join(this.workspaceRoot, ".vscode", "tasks.json");
        let doc = await vscode.workspace.openTextDocument(file);
        let te = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    };
    CheckForRebuild = async (node?: FpcItem) => {

        await lazproject.CheckBeforeBuild();
        return "";
    };
    GetProgram = async (node?: FpcItem) => {

        let project = lazproject.LoadCurrentProjectOptions();
        if (!project)
            return "";

        if (project.HostApplication)
            return project.HostApplication;

        return project.Target;
    };
    GetCWD = async (node?: FpcItem) => {

        let project = lazproject.LoadCurrentProjectOptions();
        if (!project)
            return "";

        if (project.HostApplication)
            return path.dirname(project.HostApplication);

        let cwd = project.CWD;
        if (cwd === '' || cwd === '.') {
            cwd = path.dirname(project.Target);
        }
        if (cwd === '' || cwd === '.') {
            cwd = path.dirname(project.MainFile);
        }

        return cwd;
    };
    GetLaunchArgs = async (node?: FpcItem) => {

        let args = lazproject.GetProjectArgs()
        return args;
    };
    ProjectActivate = async (node?: FpcItem) => {

        // get node file
        let file = node?.file;
        if (!file)
            return;

        lazproject.ProjectActivate(this.workspaceRoot, file);
    };
    ProjectNew = async () => {

        let s = `program main;
{$mode objfpc}{$H+}
uses
  classes,sysutils;
begin

end.`;

        let file = path.join(this.workspaceRoot, "main.lpr");


        fs.writeFile(file, s, () => {
            let f = vscode.workspace.openTextDocument(file);
            f.then((doc) => {
                vscode.window.showTextDocument(doc, vscode.ViewColumn.One)
                    .then((e: vscode.TextEditor) => {
                        let pos = new vscode.Position(2, 4);
                        e.selection = new vscode.Selection(pos, pos);
                    });

            });

        });

        let config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot));

        let v = {
            "label": "debug",
            "file": "main.lpr",
            "type": "fpc",
            "presentation": {
                "showReuseMessage": false,
                "clear": true,
                "revealProblems": "onProblem"
            },
            "buildOption": {
                "unitOutputDir": "./out",
                "customOptions": [
                    "-dDEBUG"
                ]
            }
        };
        let tasks = config.tasks;
        if (tasks) {
            tasks.push(v);
        } else {
            tasks = [v];
        }
        config.update(
            "tasks",
            tasks,
            vscode.ConfigurationTarget.WorkspaceFolder
        );

    };
    ProjectClean = async (node: FpcItem) => {

        let definition = taskProvider.GetTaskDefinition(node.label);

        let dir = definition?.buildOption?.unitOutputDir;
        if (!dir) { return; }
        if (!path.isAbsolute(dir)) {

            if (definition?.cwd) {
                let cur_dir=definition.cwd;
                if(cur_dir.startsWith('./') || cur_dir.startsWith('.\\')){
                    cur_dir=path.join(this.workspaceRoot,definition.cwd);
                }
                dir = path.join(cur_dir, dir);
            } else {
                dir = path.join(this.workspaceRoot, dir);
            }
        }

        let cleanExt = definition?.cleanExt;
        if (fs.existsSync(dir)) {
            try {
                let exts = ['.o', '.ppu', '.lfm', '.a', '.or', '.res','.rsj','.obj'];
                let isall = false;
                if (cleanExt) {
                    if ((<String>cleanExt).trim() == '*') {
                        isall = true;
                    }
                    let tmps = (<String>cleanExt).split(',');
                    for (const s of tmps) {
                        exts.push(s);
                    }
                }
                let files = fs.readdirSync(dir);
                for (let index = 0; index < files.length; index++) {
                    let file = files[index].toLowerCase();
                    let ext = path.extname(file);

                    if (isall || exts.includes(ext)) {
                        try {
                            fs2.removeSync(path.join(dir, file));
                        } catch {

                        }

                    }
                }

            } catch {

            }
        }
    };
    ProjectSetDefault = async (node: FpcItem) => {
        lazproject.ProjectActivate(this.workspaceRoot, node.file, node.label);
    }
    CodeComplete = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        client.doCodeComplete(textEditor);

    }
    CodeRename = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        client.doCodeRename(textEditor);
    }
}
