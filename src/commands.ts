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
        
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.code.complete',this.CodeComplete));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.code.rename',this.CodeRename));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.trimfromcursor',this.TrimFromCursor));
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
        vscode.tasks.fetchTasks({ type: 'fpc' }).then((e) => {
            e.forEach((task) => {
                //vscode.window.showInformationMessage(task.name);
                if (task.name === node.label) {
                    let newtask=taskProvider.taskMap.get(task.name);
                    if(newtask){
                        if (!node.forceRebuild && !rebuild) {
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

        await this.ProjectClean(node);
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
        return project.Target; 
    };
    GetCWD = async (node?: FpcItem) => {

        let project = lazproject.LoadCurrentProjectOptions();
        if (!project)
            return "";
        return project.CWD; 
    };
    ProjectActivate = async (node?: FpcItem) => {

        // get node file
        const wrkConfig = vscode.workspace.getConfiguration();
        let file = node?.file;

        // if set
        if (file) {

            // update current project
            await wrkConfig.update('fpctoolkit.currentProject', file, vscode.ConfigurationTarget.Global); 

            // get tasks
            let matched = false;
            let config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot));
            let tasks=config.tasks;
            for (const task of tasks) {
    
                // match our task
                if(task.file===file && !matched){
                    if(typeof(task.group)==='object'){
                        task.group.isDefault=true;    
                    }else{
                        task.group={kind:task.group,isDefault:true};
                    }

                    matched = true;
                   
                // all other tasks - reset    
                }else{
                    if(typeof(task.group)==='object'){
                        task.group.isDefault=undefined;
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
        }

    };
    TrimFromCursor = async (textEditor: TextEditor, edit: TextEditorEdit) => {

        const editor = vscode.window.activeTextEditor;

        if (editor) {
            const cursorPosition = editor.selection.active; // Get current cursor position

            // Get the full text from the cursor to the end of the document
            const documentText = editor.document.getText();
            const textAfterCursor = documentText.slice(editor.document.offsetAt(cursorPosition));

            // Regular expression to match leading spaces, blank lines, and trim them
            const trimmedText = textAfterCursor.replace(/^\s*\n*/, '');  // Remove leading blank lines and spaces

            // Get the range from the cursor to the end of the document
            const range = new vscode.Range(cursorPosition, editor.document.positionAt(documentText.length));

            // Perform the text replacement with the trimmed text
            await editor.edit(editBuilder => {
                editBuilder.replace(range, trimmedText);
            });
        }        
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
        let config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot));
        let tasks=config.tasks;
        for (const task of tasks) {

            // match our task
            if(task.label===node.label && task.file===node.file){
                if(typeof(task.group)==='object'){
                    task.group.isDefault=true;    
                }else{
                    task.group={kind:task.group,isDefault:true};
                }
               
            // all other tasks - reset    
            }else{
                if(typeof(task.group)==='object'){
                    task.group.isDefault=undefined;
                }
            }
           

        }
        
        await config.update(
            "tasks",
            tasks,
            vscode.ConfigurationTarget.WorkspaceFolder
        );

        vscode.commands.executeCommand('workbench.action.tasks.reloadTasks');

        // restart LSP
        client.restart();
    }
    CodeComplete = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        client.doCodeComplete(textEditor);
      
    }
    CodeRename = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        client.doCodeRename(textEditor);    
    }
}
