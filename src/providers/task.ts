/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { CompileOption } from '../languageServer/options';
import * as ChildProcess from "child_process";
import path = require('path');
import { TerminalEscape, TE_Style } from '../common/escape';
import * as fs from 'fs';
import { client } from '../extension';
import { DiagnosticSeverity } from 'vscode';

export class BuildOption {
	targetOS?: string;
	targetCPU?: string;
	customOptions?: string[];
	libPath?: string[];
	outputFile?: string;
	unitOutputDir?: string;
	optimizationLevel?: number;
	searchPath?: string[];
	syntaxMode?: string;
	forceRebuild?: boolean = false;
	msgIgnore?: Number[];
	lazbuild?: boolean;
};

export class BuildEvent{
	before_build?: string[];
	after_build_success?:string[];
	after_build_failure?:string[];
}

export class FpcTaskDefinition implements vscode.TaskDefinition {
	[name: string]: any;
	readonly type: string = 'fpc';
	file?: string;
	launchArgs?: string;
	cwd?: string;
	cleanExt?: string;
	inherited?: string;
	buildOption?: BuildOption;
	buildEvent?:BuildEvent;
}


export class FpcTaskProvider implements vscode.TaskProvider {
	static FpcTaskType = 'fpc';
	private defineMap: Map<string, FpcTaskDefinition> = new Map<string, FpcTaskDefinition>();
	public taskMap: Map<string, vscode.Task> = new Map<string, vscode.Task>();
	public GetTaskDefinition(name: string): FpcTaskDefinition | undefined {
		let result = this.defineMap.get(name);
		if (result && result.inherited) {
			let base = this.defineMap.get(result.inherited);
			if (base) {
				let realDefinition = new FpcTaskDefinition();
				this.mergeDefinition(base, realDefinition);
				this.mergeDefinition(result, realDefinition);
				return realDefinition;

			}
		}
		return result;
	}
	constructor(private workspaceRoot: string, private cwd: string | undefined = undefined) {
	}

	public async clean() {
		this.defineMap.clear();
		this.taskMap.clear();
	}
	public async provideTasks(): Promise<vscode.Task[]> {
		return this.getTasks();
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		if (this.taskMap.has(_task.name)) {
			let task = this.taskMap.get(_task.name);
			task!.definition = _task.definition;
			return task;
		} else {
			const file: string = _task.definition.file;
			if (file) {
				const definition: FpcTaskDefinition = <any>_task.definition;
				if (_task.definition.cwd) {
					this.cwd = this.workspaceRoot + '/' + _task.definition.cwd;
				}
				let task = this.getTask(_task.name, definition.file, definition);
				this.taskMap.set(_task.name, task);
				return task;
			}
		}

		return undefined;
	}

	private async getTasks(): Promise<vscode.Task[]> {
		return [];
	}
	private mergeDefinition(from: FpcTaskDefinition, to: FpcTaskDefinition) {
		to.file = to.file ?? from.file;
		to.cwd = to.cwd ?? from.cwd;
		to.cleanExt = to.cleanExt ?? from.cleanExt;
		if (from.buildOption != undefined) {
			if (to.buildOption === undefined) {
				to.buildOption = Object.assign({}, from.buildOption);
			}
			else {
				to.buildOption.customOptions = ([] as string[]).concat(from.buildOption.customOptions ?? [], to.buildOption.customOptions ?? []);
				to.buildOption.libPath = ([] as string[]).concat(from.buildOption.libPath ?? [], to.buildOption.libPath ?? []);
				to.buildOption.searchPath = ([] as string[]).concat(from.buildOption.searchPath ?? [], to.buildOption.searchPath ?? []);
				to.buildOption.msgIgnore = ([] as Number[]).concat(from.buildOption.msgIgnore ?? [], to.buildOption.msgIgnore ?? []);

				to.buildOption.optimizationLevel = to.buildOption.optimizationLevel ?? from.buildOption.optimizationLevel;
				to.buildOption.outputFile = to.buildOption.outputFile ?? from.buildOption.outputFile;
				to.buildOption.syntaxMode = to.buildOption.syntaxMode ?? from.buildOption.syntaxMode;
				to.buildOption.targetCPU = to.buildOption.targetCPU ?? from.buildOption.targetCPU;
				to.buildOption.targetOS = to.buildOption.targetOS ?? from.buildOption.targetOS;
				to.buildOption.unitOutputDir = to.buildOption.unitOutputDir ?? from.buildOption.unitOutputDir;
				to.buildOption.forceRebuild = to.buildOption.forceRebuild ?? from.buildOption.forceRebuild;

			}
		}

	}
	public getTask(name: string, file?: string, definition?: FpcTaskDefinition): vscode.Task {
		// if (definition?.inherited) {
		// 	let pdefine = this.defineMap.get(definition.inherited);
		// 	if (pdefine) {
		// 		let realDefinition = new FpcTaskDefinition();
		// 		this.mergeDefinition(definition, realDefinition);
		// 		this.mergeDefinition(pdefine, realDefinition);
		// 		this.defineMap.set(name, realDefinition);
		// 		let task = new FpcTask(this.cwd ? this.cwd : this.workspaceRoot, name, file!, definition, realDefinition);
		// 		return task;
		// 	}

		// }
		this.defineMap.set(name, definition!);
		let task = new FpcTask(this.cwd ? this.cwd : this.workspaceRoot, name, file!, definition!);


		// task.presentationOptions.clear = true;
		// task.presentationOptions.echo = true;
		// task.presentationOptions.focus = false;
		// task.presentationOptions.showReuseMessage = false;
		// task.presentationOptions.reveal = vscode.TaskRevealKind.Always;
		// task.presentationOptions.panel = vscode.TaskPanelKind.Shared;
		//  task.presentationOptions.revealProblems='onProblem';
		//(task.presentationOptions as any)["revealProblems"]="onProblem";

		//task.problemMatchers.push('$fpc');


		return task;
	}

	public refresh() {
		client.restart();
	}
}

export enum BuildMode {
	normal,
	rebuild
}
export class FpcTask extends vscode.Task {
	private _BuildMode: BuildMode = BuildMode.normal;
	public get BuildMode(): BuildMode {
		return this._BuildMode;
	}
	public set BuildMode(value: BuildMode) {
		this._BuildMode = value;
	}
	constructor(cwd: string, name: string, file: string, taskDefinition: FpcTaskDefinition) {

		super(
			taskDefinition,
			vscode.TaskScope.Workspace,
			`${name}`,
			FpcTaskProvider.FpcTaskType,
			//new vscode.ShellExecution(`${fpcpath} ${taskDefinition.file} ${buildOptionString}`)
			new FpcCustomExecution(async (): Promise<vscode.Pseudoterminal> => {
				// 	// When the task is executed, this callback will run. Here, we setup for running the task.
				// let terminal = new  FpcBuildTaskTerminal(workspaceRoot, fpcpath!);
				//terminal.args =  `${taskDefinition?.file} ${buildOptionString}`.split(' ');

				//taskProvider.GetTaskDefinition()
				let buildOptionString: string = '';
				let realDefinition=taskProvider.GetTaskDefinition(name);
				if (realDefinition === undefined) {
					realDefinition = taskDefinition;
				}
				let lazbuild: boolean = false;
				let forceRebuild: boolean = false;

				if (realDefinition?.buildOption) {
					lazbuild = realDefinition.buildOption.lazbuild ?? false;
					forceRebuild = realDefinition.buildOption.forceRebuild ?? false;

					if (!lazbuild) {
						let opt: CompileOption = new CompileOption(realDefinition);
						buildOptionString = opt.toOptionString();
					}
				}
				if (!buildOptionString) {
					buildOptionString = "";
				}

				if (!realDefinition) {
					realDefinition = {
						type: FpcTaskProvider.FpcTaskType,
						file: file,

					};

				}

				if (!lazbuild) {
					buildOptionString += '-vq '; //show message numbers
				}

				let fpcpath = process.env['PP'];//  configuration.get<string>('env.PP');
				if (fpcpath === '') {
					fpcpath = 'fpc';
				}
				if (lazbuild) {
					fpcpath = 'lazbuild';
				}

				let terminal = new FpcBuildTaskTerminal(cwd, fpcpath!);
				if(taskDefinition.buildEvent){
					if(taskDefinition.buildEvent.before_build){
						let commands=taskDefinition.buildEvent.before_build;
						terminal.event_before_build=()=>{
							for (const cmd of commands) {
								let result=ChildProcess.execSync(cmd);
								terminal.emit(result.toString())
							}
						}
					}
					if(taskDefinition.buildEvent.after_build_failure || taskDefinition.buildEvent.after_build_success){
						let commands_failure=taskDefinition.buildEvent.after_build_failure;
						let commands_success=taskDefinition.buildEvent.after_build_success;
						terminal.event_after_build=(success)=>{
							if(success && commands_success){
								for (const cmd of commands_success) {
									let result=ChildProcess.execSync(cmd);
									terminal.emit(result.toString())
								}
							}else if(commands_failure)
								for (const cmd of commands_failure) {
									let result=ChildProcess.execSync(cmd);
									terminal.emit(result.toString())
								}

							}

					}

				}

				terminal.args = `${taskDefinition?.file} ${buildOptionString}`.trim().split(' ');
				if (this._BuildMode == BuildMode.rebuild || forceRebuild) {
					terminal.args.push('-B');

					this._BuildMode = BuildMode.normal;
				}
				return terminal;

			})
		);
		//this.TaskBuildOptionString = buildOptionString;
	}


}

class FpcCustomExecution extends vscode.CustomExecution {

}
export var diagCollection: vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection('fpc');

class FpcBuildTaskTerminal implements vscode.Pseudoterminal, vscode.TerminalExitStatus {
	public reason: vscode.TerminalExitReason = vscode.TerminalExitReason.Process;
	private writeEmitter = new vscode.EventEmitter<string>();
	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	private closeEmitter = new vscode.EventEmitter<number>();
	onDidClose: vscode.Event<number> = this.closeEmitter.event;

	public event_before_build?:()=>void;
	public event_after_build?:(success:boolean)=>void;

	private process?: ChildProcess.ChildProcess;
	protected buffer: string = "";
	protected errbuf: string = "";

	// Changed from Map to hash object and order array
	private diagMaps: { [key: string]: vscode.Diagnostic[] } = {};
	private diagOrder: string[] = [];
	public args: string[] = [];

	constructor(private cwd: string, private fpcpath: string) {
		this.onDidClose((e) => {
			//vscode.window.showInformationMessage('onDidClose');
		});
	}
	code: number | undefined;

	clear() {

	}
	open(initialDimensions: vscode.TerminalDimensions | undefined): void {
		//vscode.window.createTerminal()
		// At this point we can start using the terminal.
		this.doBuild();
	}

	close(): void {

	}


	async buildend() {
		let units = this.diagOrder;

		// The terminal has been closed. Shutdown the build.
		diagCollection.clear();
		let has_error: boolean = false;
		for (const key of units) {
			let item = this.diagMaps[key];
			let uri: vscode.Uri | undefined = undefined;
			if (fs.existsSync(key)) {
				uri = vscode.Uri.file(key);
			}
			if (!uri) {
				let unit = key.split(".")[0];

				let unitpaths = await client.getUnitPath([unit]);
				if (unitpaths.length < 1) {
					return;
				}
				let unitpath = unitpaths[0];
				if (unitpath == '') {
					uri = this.findFile(key)!;
				} else {
					uri = vscode.Uri.file(unitpath);
				}
			}

			if (uri) {
				diagCollection.set(uri, item);
			} else {
				diagCollection.set(vscode.Uri.file(key), item);
			}
			if (!has_error) {
				item.forEach((d) => {
					if (d.severity === DiagnosticSeverity.Error) {
						has_error = true;
					}
				});
			}
		}

		if (has_error) {
			vscode.commands.executeCommand('workbench.actions.view.problems');
		}
	}
	findFile(filename: string): vscode.Uri | undefined {

		let f = path.join(this.cwd, filename);
		if (fs.existsSync(f)) {
			return vscode.Uri.file(f);
		}
		for (let index = 0; index < this.args.length; index++) {
			const e = this.args[index];
			if (e.startsWith('-Fu')) {
				let f2 = e.substring(3);
				if (f2.startsWith('.')) {
					f = path.join(this.cwd, f2, filename);
				} else {
					f = path.join(f2, filename);
				}
				if (fs.existsSync(f)) {
					return vscode.Uri.file(f);
				}
			}
		}
		return undefined;
	}


	private async doBuild(): Promise<number> {
		return new Promise<number>((resolve) => {

			this.buffer = "";
			this.errbuf = "";
			this.diagMaps = {};
			this.diagOrder = [];
			if(this.event_before_build){
				this.event_before_build();
			}
			this.emit(TerminalEscape.apply({ msg: `${this.fpcpath} ${this.args.join(' ')}\r\n`, style: [TE_Style.Bold] }));
			this.process = ChildProcess.spawn(this.fpcpath, this.args, { cwd: this.cwd });

			this.process.stdout?.on('data', this.stdout.bind(this));
			this.process.stderr?.on('data', this.stderr.bind(this));
			this.process.on('close', (code) => {

				this.writeEmitter.fire(`Exited with code ${code}.\r\nBuild complete. \r\n\r\n`);
				this.buildend().then(() => {
					this.closeEmitter.fire(code);
				});
				if(this.event_after_build){
					this.event_after_build(code==0);
				}
				//This is a exitcode,not zero meens failure.
				if (code!=0) {

					// Select the first
					vscode.commands.executeCommand('list.select');
				}


				resolve(0);
			});

		});
	}


	emit(msg: string) {
		this.writeEmitter.fire(msg + '\r\n');
	}
	stdout(data: any) {
		if (typeof data === "string") {
			this.buffer += data;
		}
		else {
			this.buffer += data.toString("utf8");
		}
		const end = this.buffer.lastIndexOf('\n');
		if (end !== -1) {
			this.onOutput(this.buffer.substr(0, end));
			this.buffer = this.buffer.substr(end + 1);
		}
	}

	stderr(data: any) {
		if (typeof data === "string") {
			this.emit(TerminalEscape.apply({ msg: data, style: [TE_Style.Yellow] }));

		}
		else {
			this.emit(TerminalEscape.apply({ msg: data.toString("utf8"), style: [TE_Style.Yellow] }));
		}
	}
	getDiagnosticSeverity(level: string) {
		switch (level) {
			case 'Fatal':
			case 'Error':
				return vscode.DiagnosticSeverity.Error;
			case 'Warning':
				return vscode.DiagnosticSeverity.Warning;
			case 'Note':
				return vscode.DiagnosticSeverity.Information;
			case 'Hint':
//				return vscode.DiagnosticSeverity.Hint;
				return vscode.DiagnosticSeverity.Information;
			default:
				return vscode.DiagnosticSeverity.Information;
		}
	}
	onOutput(lines: string) {
		let ls = <string[]>lines.split('\n');
		let reg = /^([\w\/\.]+\.(dpr|p|pp|pas))\((\d+),(\d+)\)\s((Fatal|Error|Warning|Note|Hint):\s\((\w+)\) (.*))/
		ls.forEach(line => {
			// Regex match
			let matchs = reg.exec(line);
			if (matchs) {

				// Parse
				let ln = Number(matchs[3]);
				let col = Number(matchs[4]);
				let file = matchs[1];
				let level = matchs[6];
				let msgcode = matchs[7];
				let msg = matchs[8];

				// Create
				let diag = new vscode.Diagnostic(
					new vscode.Range(new vscode.Position(ln - 1, col - 1), new vscode.Position(ln - 1, col - 1)),
					level + ': ' + msg,
					this.getDiagnosticSeverity(level)
				);
				diag.code = Number.parseInt(msgcode);

				// Emit to terminal
				if (diag.severity == DiagnosticSeverity.Error) {
					this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Red] }));
				} else {
					this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Cyan] }));
				}

				// Special error 5088 handling - "Error: Found declaration" - this is a secondary error with a lower line position so VSCode prioritizes it and hides the primary error
				if (diag.code == 5088) {
					// Set the Warning severity
					diag.severity = DiagnosticSeverity.Warning;
				}

				// Add to diags
				let basename = file;
				if (this.diagMaps[basename]) {
					this.diagMaps[basename].push(diag);
				} else {
					this.diagMaps[basename] = [diag];
					this.diagOrder.push(basename);
				}

			} else if (line.startsWith('Error:') || line.startsWith('Fatal:')) { //Fatal|Error|Note
				this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.Red] }));
			} else if (line.startsWith('Warning:')) {
				this.emit(TerminalEscape.apply({ msg: line, style: [TE_Style.BrightYellow] }));
			}
			else {
				this.emit(line);
			}
		});
	}

}

export let taskProvider: FpcTaskProvider;

if (vscode.workspace.workspaceFolders) {
	const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
	taskProvider = new FpcTaskProvider(workspaceRoot);
}

