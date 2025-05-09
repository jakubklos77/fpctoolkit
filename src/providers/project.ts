import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { basename, normalize } from 'path';
import { CompileOption, TaskInfo } from '../languageServer/options';
import { openStdin } from 'process';
import { FpcTaskDefinition, FpcTaskProvider, taskProvider } from './task';
import { Command } from 'vscode-languageserver-types';
//import { visit, JSONVisitor } from "jsonc-parser";
import { pathExists } from 'fs-extra';
import { Event } from 'vscode-languageclient';
import { clearTimeout } from 'timers';
import { TIMEOUT } from 'dns';
import { lazproject } from '../common/lazproject'

export class FpcProjectProvider implements vscode.TreeDataProvider<FpcItem> {

	private _onDidChangeTreeData: vscode.EventEmitter<FpcItem | undefined | void> = new vscode.EventEmitter<FpcItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<FpcItem | undefined | void> = this._onDidChangeTreeData.event;
	private watch!: vscode.FileSystemWatcher;
	private watchlpr!: vscode.FileSystemWatcher;
	public defaultFtpItem: FpcItem | undefined = undefined;
	private config!:vscode.WorkspaceConfiguration;
	private defaultCompileOption?:CompileOption=undefined;
	private timeout?:NodeJS.Timeout=undefined;

	private lastOpenProjectClickTime = 0;
	private lastOpenProjectElement: FpcItem | undefined;

	constructor(private workspaceRoot: string, context: vscode.ExtensionContext) {
		const subscriptions = context.subscriptions;
		const name = 'FpcProjectExplorer';
		subscriptions.push(vscode.commands.registerCommand(name + ".open", async (item: FpcItem) => { await this.OpenProject(item); }, this));

		this.watch = vscode.workspace.createFileSystemWatcher(path.join(workspaceRoot,".vscode","tasks.json"), false);
		this.watch.onDidChange(async (url) => {
			taskProvider.clean();
			if(this.timeout!=undefined){
				clearTimeout(this.timeout);
			}
			this.timeout=setTimeout(()=>{
				this.checkDefaultAndRefresh();
			},1000);
		});
		this.watch.onDidDelete(() => {
			this.refresh();
		});

		this.watchlpr = vscode.workspace.createFileSystemWatcher("**/*.lpr", false, true, false);
		this.watchlpr.onDidCreate(() => {
			this.refresh();
		});
		this.watchlpr.onDidDelete(() => {
			this.refresh();
		});

	}


	dispose() {
		throw new Error("Method not implemented.");
	}


	/*TreeDataProvider*/
	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	async checkDefaultAndRefresh():Promise<void>{
		let oldCompileOption=this.defaultCompileOption;
		if(oldCompileOption==undefined){
			taskProvider.refresh();
			this.refresh();
			return;
		}

		//default task setting changed
		let newCompileOption = this.GetDefaultProjectCompileOption();
		if(oldCompileOption.toOptionString()!=newCompileOption.toOptionString()){
			taskProvider.refresh();
		}
		this.refresh();



	}
	getTreeItem(element: FpcItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: FpcItem | undefined): vscode.ProviderResult<FpcItem[]> {

		if (element) {
			this.defaultFtpItem=undefined;
			let items: FpcItem[] = [];
			/* currently we do not want any children here
			element.tasks?.forEach((task) => {
				let item = new FpcItem(
					1,
					task.label,
					vscode.TreeItemCollapsibleState.None,
					element.file,
					element.fileexist,
					task.group?.isDefault,
					[task]
				);
				items.push(item);
				if (item.isDefault) {
					this.defaultFtpItem = item;
				}
			});
			*/
			return Promise.resolve(items);

		} else {
			//root node

			var itemMaps: Map<string, FpcItem> = new Map();
			this.config = vscode.workspace.getConfiguration('tasks', vscode.Uri.file(this.workspaceRoot));

			this.config?.tasks?.forEach((e: any) => {
				if (e.type === 'fpc') {
					if (!itemMaps.has(e.file)) {
						itemMaps.set(
							e.file,
							new FpcItem(
								0,
								e.label,
								vscode.TreeItemCollapsibleState.None,
								e.file,
								true,
								e.group?.isDefault,
								[e]
							)
						);
					} else {
						itemMaps.get(e.file)?.tasks?.push(e);
					}
				}

			});
			let items: FpcItem[] = [];

			for (const e of itemMaps.values()) {
				items.push(e);
			}

			return Promise.resolve(items);
		}
	}
	GetDefaultProjectCompileOption(): CompileOption  {

		let opt: CompileOption|undefined=undefined;
		let taskDef = lazproject.getProjectFpcTaskDefinition();

		if (taskDef) {
			opt = new CompileOption(taskDef, this.workspaceRoot);
			this.defaultCompileOption = opt;
			return opt;
		}

		if(!opt){
			opt = new CompileOption();
		}
		this.defaultCompileOption = opt;
		return opt;
	}
	private findJsonDocumentPosition(documentText: string, taskItem: FpcItem) {
		// const me = this;
		// let inScripts = false;
		// let inTasks = false;
		// let inTaskLabel: any;
		// let scriptOffset = 0;


		// const visitor: JSONVisitor =
		// {
		// 	onError: () => {
		// 		return scriptOffset;
		// 	},
		// 	onObjectEnd: () => {
		// 		if (inScripts) {
		// 			inScripts = false;
		// 		}
		// 	},
		// 	onLiteralValue: (value: any, offset: number, _length: number) => {
		// 		if (inTaskLabel) {
		// 			if (typeof value === "string") {
		// 				if (inTaskLabel === "label" || inTaskLabel === "script") {

		// 					if (taskItem.label === value) {
		// 						scriptOffset = offset;
		// 					}
		// 				}
		// 			}
		// 			inTaskLabel = undefined;
		// 		}
		// 	},
		// 	onObjectProperty: (property: string, offset: number, _length: number) => {
		// 		if (property === "tasks") {
		// 			inTasks = true;
		// 			if (!inTaskLabel) { // select the script section
		// 				scriptOffset = offset;
		// 			}
		// 		}
		// 		else if ((property === "label" || property === "script") && inTasks && !inTaskLabel) {
		// 			inTaskLabel = "label";
		// 			if (!inTaskLabel) { // select the script section
		// 				scriptOffset = offset;
		// 			}
		// 		}
		// 		else { // nested object which is invalid, ignore the script
		// 			inTaskLabel = undefined;
		// 		}
		// 	}
		// };

		// visit(documentText, visitor);

		// //log.methodDone("find json document position", 3, "   ", false, [["position", scriptOffset]]);
		// return scriptOffset;
		return documentText.indexOf('"label": "'+taskItem.label+'"');
	}

	private async OpenProject(selection: FpcItem) {

		let taskfile = vscode.Uri.file(path.join(this.workspaceRoot, '.vscode', 'tasks.json'))

		fs.existsSync(taskfile.fsPath)
		{
			const document: vscode.TextDocument = await vscode.workspace.openTextDocument(taskfile);
			const offset = this.findJsonDocumentPosition(document.getText(), selection);
			const position = document.positionAt(offset);
			await vscode.window.showTextDocument(document, { selection: new vscode.Selection(position, position) });
		}
	}

}

export class FpcItem extends vscode.TreeItem {


	constructor(
		public readonly level: number,
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly file: string,
		public fileexist: boolean,
		public isDefault: boolean,
		public tasks?: any[],
		public forceRebuild?: boolean,
	) {
		super(label, collapsibleState);
		if (level === 0) {
			this.contextValue = 'fpcproject';
		} else {
			this.contextValue = 'fpcbuild';
		}
		this.tooltip = `${basename(this.label)} `;
		if (this.level === 0) {
			this.description = this.isDefault ? 'default' : '';

			const command = {
				command: "FpcProjectExplorer.open", // commandId is a string that contains the registered id ('myExtension.debugMessage')
				title: '',
				arguments: [this]
			};
			this.command = command;
		}

		this.iconPath=this.level? new vscode.ThemeIcon('wrench'):path.join(__filename, '..','..',  'images','pascal-project.png');

	}
}