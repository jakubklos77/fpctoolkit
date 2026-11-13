import * as vscode from 'vscode';

/**
 * Opens the real working-tree (file:) version of the document shown in the
 * active editor, e.g. when the active editor is a read-only Git revision
 * opened from "Compare with Branch" / "Open File" in Source Control.
 *
 * Nothing here writes to disk, touches Git state or changes settings - it only
 * resolves a URI and opens/focuses a normal text editor.
 */

// Minimal subset of the built-in Git extension API (vscode.git, API v1).
// Declared locally so no new dependency is needed.
interface GitRepository {
    readonly rootUri: vscode.Uri;
}
interface GitAPI {
    getRepository(uri: vscode.Uri): GitRepository | null;
}
interface GitExtension {
    readonly enabled: boolean;
    getAPI(version: 1): GitAPI;
}

// Query format the built-in Git extension uses in its `toGitUri()`:
//   uri.with({ scheme: 'git', path: <file path>[.git|.diff], query: JSON.stringify({ path: <fsPath>, ref, submoduleOf? }) })
interface GitUriParams {
    path: string;
    ref: string;
    submoduleOf?: string;
}

class ResolveError extends Error { }

export const OPEN_WRITABLE_WORKING_TREE_FILE = 'fpctoolkit.editor.openWritableWorkingTreeFile';

export class WorkingTreeCommandManager {

    registerAll(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand(OPEN_WRITABLE_WORKING_TREE_FILE, this.OpenWritableWorkingTreeFile));
    }

    OpenWritableWorkingTreeFile = async () => {
        try {
            const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
            const editor = vscode.window.activeTextEditor;

            const sourceUri = editor?.document.uri ?? this.uriFromTab(activeTab);
            if (!sourceUri) {
                throw new ResolveError('No active editor.');
            }

            // Already a plain, writable file editor (not a diff) - nothing to do.
            if (sourceUri.scheme === 'file' && activeTab?.input instanceof vscode.TabInputText &&
                activeTab.input.uri.toString() === sourceUri.toString()) {
                vscode.window.setStatusBarMessage('Already editing the working-tree file.', 3000);
                return;
            }

            const target = await this.resolveWorkingTreeUri(sourceUri);

            const selections = editor?.selections;
            const visibleRange = editor?.visibleRanges[0];

            // Reuse an existing normal (non-diff) editor tab for that file if there is one.
            const viewColumn = this.findExistingTabColumn(target) ?? vscode.window.tabGroups.activeTabGroup.viewColumn;

            const document = await vscode.workspace.openTextDocument(target);
            const opened = await vscode.window.showTextDocument(document, { viewColumn, preview: false, preserveFocus: false });

            // Carry over cursor/selection. The source may be an older revision (or the other
            // side of a diff), so map line numbers through a line diff of the two texts.
            if (editor && selections && selections.length > 0) {
                const mapper = editor.document.uri.toString() === target.toString()
                    ? undefined
                    : new LineMapper(editor.document.getText(), document.getText());
                const mapPos = (p: vscode.Position) => document.validatePosition(
                    mapper ? new vscode.Position(mapper.map(p.line), p.character) : p);

                opened.selections = selections.map(s => new vscode.Selection(mapPos(s.anchor), mapPos(s.active)));
                if (visibleRange) {
                    const top = mapPos(visibleRange.start);
                    opened.revealRange(new vscode.Range(top, top), vscode.TextEditorRevealType.AtTop);
                }
                opened.revealRange(opened.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Open Writable Working-Tree File: ${msg}`);
        }
    };

    /** URI of the active tab when no text editor has focus (e.g. focus is on a tab header). */
    private uriFromTab(tab: vscode.Tab | undefined): vscode.Uri | undefined {
        if (!tab) { return undefined; }
        if (tab.input instanceof vscode.TabInputText) { return tab.input.uri; }
        if (tab.input instanceof vscode.TabInputTextDiff) { return tab.input.modified; }
        return undefined;
    }

    /** Column of a normal (non-diff) editor tab already showing `uri`, preferring the active group. */
    private findExistingTabColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
        const key = uri.toString();
        const groups = [vscode.window.tabGroups.activeTabGroup,
            ...vscode.window.tabGroups.all.filter(g => g !== vscode.window.tabGroups.activeTabGroup)];
        for (const group of groups) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === key) {
                    return group.viewColumn;
                }
            }
        }
        return undefined;
    }

    /** Maps the active document URI to the physical working-tree file and validates it. */
    private async resolveWorkingTreeUri(uri: vscode.Uri): Promise<vscode.Uri> {
        let candidate: vscode.Uri;

        switch (uri.scheme) {
            case 'file':
                // e.g. modified side of a diff editor - already the physical file
                candidate = uri;
                break;
            case 'git':
                candidate = this.resolveGitUri(uri);
                break;
            case 'untitled':
                throw new ResolveError('The active document is untitled and has no working-tree file.');
            default:
                candidate = this.resolveOtherVcsUri(uri);
                break;
        }

        await this.validateWorkingTreeFile(candidate);
        return candidate;
    }

    /**
     * Built-in Git extension URIs carry the original file's fsPath in the JSON query.
     * Cross-check it against the URI path so we never open a file the URI doesn't refer to.
     */
    private resolveGitUri(uri: vscode.Uri): vscode.Uri {
        let params: Partial<GitUriParams>;
        try {
            params = JSON.parse(uri.query);
        } catch {
            throw new ResolveError(`Unrecognised Git URI (query is not Git metadata): ${uri.toString()}`);
        }
        if (!params || typeof params.path !== 'string' || params.path.length === 0) {
            throw new ResolveError(`Git URI does not contain a file path: ${uri.toString()}`);
        }
        if (params.submoduleOf) {
            throw new ResolveError('The active document is a submodule diff, not a file.');
        }

        const fileUri = vscode.Uri.file(params.path);
        // toGitUri() keeps uri.path and may append '.git' (replaceFileExtension) to it.
        if (uri.path !== fileUri.path && uri.path !== `${fileUri.path}.git`) {
            throw new ResolveError(`Ambiguous Git URI: path "${uri.path}" does not match "${params.path}".`);
        }
        return fileUri;
    }

    /**
     * Other SCM providers (e.g. GitLens 'gitlens:' revision URIs) keep the working-tree
     * path as the URI path. Accept it only if any JSON `path` metadata agrees; the result is
     * then validated (inside a workspace folder, existing file) before it is opened.
     */
    private resolveOtherVcsUri(uri: vscode.Uri): vscode.Uri {
        const fromPath = vscode.Uri.file(uri.path);
        let metaPath: string | undefined;
        if (uri.query) {
            try {
                const q = JSON.parse(uri.query);
                if (q && typeof q.path === 'string') { metaPath = q.path; }
            } catch {
                // non-JSON query - rely on path validation only
            }
        }
        if (metaPath !== undefined && vscode.Uri.file(metaPath).path !== fromPath.path) {
            throw new ResolveError(`Ambiguous '${uri.scheme}:' URI: path "${uri.path}" does not match "${metaPath}".`);
        }
        return fromPath;
    }

    private async validateWorkingTreeFile(fileUri: vscode.Uri) {
        const folder = vscode.workspace.getWorkspaceFolder(fileUri);
        if (!folder) {
            throw new ResolveError(`"${fileUri.fsPath}" is not inside an open workspace folder.`);
        }

        // If the Git extension is available, the file must also belong to a Git repository.
        const git = this.getGitAPI();
        if (git && !git.getRepository(fileUri)) {
            throw new ResolveError(`"${fileUri.fsPath}" does not belong to a Git repository known to VS Code.`);
        }

        let stat: vscode.FileStat;
        try {
            stat = await vscode.workspace.fs.stat(fileUri);
        } catch {
            throw new ResolveError(`Working-tree file does not exist: ${fileUri.fsPath}`);
        }
        if ((stat.type & vscode.FileType.File) === 0) {
            throw new ResolveError(`Not a file: ${fileUri.fsPath}`);
        }
    }

    private getGitAPI(): GitAPI | undefined {
        try {
            const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if (!ext || !ext.isActive || !ext.exports.enabled) { return undefined; }
            return ext.exports.getAPI(1);
        } catch {
            return undefined;
        }
    }
}

/**
 * Maps line numbers of one text version to another using a line diff (Myers),
 * after trimming the common prefix/suffix. Lines inside a changed block map to the
 * same offset in the corresponding changed block of the target (clamped to it);
 * lines of a deleted block map to the line following the deletion.
 */
export class LineMapper {
    private static readonly MAX_EDIT_DISTANCE = 2000;

    private readonly n: number;
    private readonly m: number;
    private readonly prefix: number;
    private readonly suffix: number;
    /** Matched (source, target) line pairs of the middle part, ascending, absolute line numbers. */
    private readonly matches: [number, number][] | undefined;

    constructor(source: string, target: string) {
        const a = source.split(/\r\n|\r|\n/);
        const b = target.split(/\r\n|\r|\n/);
        this.n = a.length;
        this.m = b.length;

        let p = 0;
        while (p < this.n && p < this.m && a[p] === b[p]) { p++; }
        let s = 0;
        while (s < this.n - p && s < this.m - p && a[this.n - 1 - s] === b[this.m - 1 - s]) { s++; }
        this.prefix = p;
        this.suffix = s;

        const mid = LineMapper.myers(a.slice(p, this.n - s), b.slice(p, this.m - s), LineMapper.MAX_EDIT_DISTANCE);
        this.matches = mid?.map(([x, y]) => [x + p, y + p] as [number, number]);
    }

    map(line: number): number {
        const { n, m, prefix, suffix } = this;
        if (line < prefix) { return line; }
        if (line >= n - suffix) { return Math.min(m - 1, line - n + m); }

        // Bracketing anchors: last match at/before `line` and first match after it.
        let prev: [number, number] = [prefix - 1, prefix - 1];
        let next: [number, number] = [n - suffix, m - suffix];
        if (this.matches) {
            let lo = 0, hi = this.matches.length - 1, idx = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (this.matches[mid][0] <= line) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
            }
            if (idx >= 0) {
                if (this.matches[idx][0] === line) { return this.matches[idx][1]; }
                prev = this.matches[idx];
            }
            if (idx + 1 < this.matches.length) { next = this.matches[idx + 1]; }
        } else {
            // Diff too large: proportional position within the changed middle part.
            const srcLen = n - suffix - prefix, dstLen = m - suffix - prefix;
            const t = prefix + Math.floor((line - prefix) * dstLen / Math.max(1, srcLen));
            return Math.max(0, Math.min(m - 1, t));
        }

        const first = prev[1] + 1;                  // first target line of the changed block
        const last = Math.max(first, next[1] - 1);  // last target line (== first for a pure deletion)
        const t = first + (line - prev[0] - 1);
        return Math.max(0, Math.min(m - 1, Math.min(last, t)));
    }

    /** Myers O(ND) diff; returns matched index pairs, or undefined if edit distance exceeds maxD. */
    private static myers(a: string[], b: string[], maxD: number): [number, number][] | undefined {
        const N = a.length, M = b.length, MAX = N + M;
        if (N === 0 || M === 0) { return []; }
        const off = MAX + 1;
        const v = new Int32Array(2 * MAX + 3);
        const trace: Int32Array[] = [];

        for (let d = 0; d <= Math.min(MAX, maxD); d++) {
            trace.push(v.slice(off - d - 1, off + d + 2)); // indices k in [-d-1, d+1]
            for (let k = -d; k <= d; k += 2) {
                let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
                let y = x - k;
                while (x < N && y < M && a[x] === b[y]) { x++; y++; }
                v[off + k] = x;
                if (x >= N && y >= M) {
                    return LineMapper.backtrack(trace, N, M);
                }
            }
        }
        return undefined;
    }

    private static backtrack(trace: Int32Array[], N: number, M: number): [number, number][] {
        const out: [number, number][] = [];
        let x = N, y = M;
        for (let d = trace.length - 1; d >= 0; d--) {
            const snap = trace[d];
            const at = (k: number) => snap[k + d + 1];
            const k = x - y;
            const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
            const prevX = at(prevK);
            const prevY = prevX - prevK;
            while (x > prevX && y > prevY) { x--; y--; out.push([x, y]); }
            if (d > 0) { x = prevX; y = prevY; }
        }
        return out.reverse();
    }
}
