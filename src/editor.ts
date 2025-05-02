import * as vscode from 'vscode';
import { TextEditor, TextEditorEdit } from 'vscode';

export class EditorCommandManager {

    constructor() {
    }

    registerAll(context: vscode.ExtensionContext) {

        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.trimfromcursor', this.TrimFromCursor));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.jumpToPreviousIndent', this.JumpToPreviousIndent));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.jumpToNextIndent', this.JumpToNextIndent));

        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.base64encode', this.Base64Encode));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.base64decode', this.Base64Decode));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.hexencode', this.HexEncode));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.hexdecode', this.HexDecode));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.urlencode', this.URLEncode));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.urldecode', this.URLDecode));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.generateuuid', this.GenerateUUID));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand('fpctoolkit.editor.quotedprintabledecode', this.QuotedPrintableDecode));
    }

    TrimFromCursor = async (textEditor: TextEditor, edit: TextEditorEdit) => {

        const editor = vscode.window.activeTextEditor;

        if (editor) {
            const cursorPosition = editor.selection.active; // Get current cursor position
            const documentText = editor.document.getText();
            const textAfterCursor = documentText.slice(editor.document.offsetAt(cursorPosition));
            const textBeforeCursor = documentText.slice(editor.document.offsetAt(cursorPosition) - 1, editor.document.offsetAt(cursorPosition));

            let deleteLength = 0;

            // Helper function to determine if a character is a word character
            const isWordChar = (char: string) => /[a-zA-Z0-9_#]/.test(char);

            // Helper function to determine if a character is whitespace
            const isWhitespace = (char: string) => /\s/.test(char);

            // Helper function to determine if a character is a special character
            const isSpecialChar = (char: string) => /[^\w\s]/.test(char);

            // Helper function for CRLF detection
            const isCRLF = (char: string) => char === '\n' || char === '\r';

            // Initialize flags
            let isStartWord = false;
            let isBeforeWord = false;
            let isStartCRLF = false;
            if (textBeforeCursor.length>0)
                isBeforeWord = isWordChar(textBeforeCursor[0]);
            if (textAfterCursor.length>0) {
                isStartWord = isWordChar(textAfterCursor[0]);
                isStartCRLF = isCRLF(textAfterCursor[0]);
            }

            for (let i = 0; i < textAfterCursor.length; i++) {

                const char = textAfterCursor[i];
                const nextChar = textAfterCursor[i + 1] || '';

                if (isWhitespace(char)) {
                    // If in whitespace, delete spaces and tabs until the next non-whitespace character
                    if (isCRLF(char)) {

                        if (isStartCRLF && isWhitespace(nextChar) && !isCRLF(nextChar)) {
                            isStartCRLF = false;
                            continue;
                        }

                        // If a blank line is encountered, delete only the first one and stop
                        deleteLength = i + 1;
                        break;
                    } else if (!isWhitespace(nextChar)) {
                        deleteLength = i + 1;
                        break;
                    }
                } else if (isWordChar(char)) {
                    // If in a word, delete until the end of the word or a special character
                    if (!isWordChar(nextChar)) {

                        // The char before was not a word so we want to delete all the way to next whitespaces
                        if (!isBeforeWord && isWhitespace(nextChar) && !isCRLF(nextChar))
                            continue;

                        deleteLength = i + 1;
                        break;
                    }
                } else if (isSpecialChar(char)) {
                    // If in special characters, delete until the group of special characters ends
                    if (!isSpecialChar(nextChar)) {

                        // Delete to all whitespaces
                        if (isWhitespace(nextChar) && !isCRLF(nextChar))
                            continue;

                        deleteLength = i + 1;
                        break;
                    }
                }
            }

            // Get the range to delete
            const range = new vscode.Range(
                cursorPosition,
                editor.document.positionAt(editor.document.offsetAt(cursorPosition) + deleteLength)
            );

            // Perform the text replacement (deletion)
            await editor.edit(editBuilder => {
                editBuilder.delete(range);
            });
        }
    };

    private getIndentLevel(line: string): number {
        return line.search(/\S|$/); // Index of first non-whitespace char
    }

    private isNotBlank(line: string): boolean {
        return line.trim().length > 0;
    }

    private findFirstNonBlankLine(doc: vscode.TextDocument, start: number, direction: -1 | 1): number {
        const limit = direction === -1 ? 0 : doc.lineCount - 1;
        for (let i = start; direction === -1 ? i >= limit : i <= limit; i += direction) {
            if (this.isNotBlank(doc.lineAt(i).text)) {
                return i;
            }
        }
        return start;
    }

    JumpToPreviousIndent = async (textEditor: TextEditor, edit: TextEditorEdit) => {

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const doc = editor.document;
        const cursorLine = editor.selection.active.line;

        const baseLine = this.findFirstNonBlankLine(doc, cursorLine, -1);
        let baseIndent = this.getIndentLevel(doc.lineAt(baseLine).text);

        let first = true;
        for (let i = baseLine - 1; i >= 0; i--) {
            const text = doc.lineAt(i).text;
            if (!this.isNotBlank(text))
                continue;

            // First next line
            if (first) {
                first = false;

                // We go deeper
                let firstLevel = this.getIndentLevel(text);
                if (firstLevel > baseIndent) {
                    // Set new base indent
                    baseIndent = firstLevel;
                }
            }

            if (this.getIndentLevel(text) < baseIndent) {
                const targetCol = this. getIndentLevel(text);
                const pos = new vscode.Position(i, targetCol);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos));
                return;
            }
        }
    };

    JumpToNextIndent = async (textEditor: TextEditor, edit: TextEditorEdit) => {

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const doc = editor.document;
        const totalLines = doc.lineCount;
        const cursorLine = editor.selection.active.line;

        const baseLine = this.findFirstNonBlankLine(doc, cursorLine, 1);
        let baseIndent = this.getIndentLevel(doc.lineAt(baseLine).text);

        let first = true;
        for (let i = baseLine + 1; i < totalLines; i++) {
            const text = doc.lineAt(i).text;
            if (!this.isNotBlank(text))
                continue;

            // First next line
            if (first) {
                first = false;

                // We go deeper
                let firstLevel = this.getIndentLevel(text);
                if (firstLevel > baseIndent) {
                    // Set new base indent
                    baseIndent = firstLevel;
                }
            }
            if (this.getIndentLevel(text) < baseIndent) {
                const targetCol = this.getIndentLevel(text);
                const pos = new vscode.Position(i, targetCol);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos));
                return;
            }
        }
    };

    // Helper: Get the selected text and its range, or the whole document if no selection
    private getSelectedTextAndRange(editor: TextEditor): { text: string, range: vscode.Range } {
        const selection = editor.selection;
        if (!selection.isEmpty) {
            return {
                text: editor.document.getText(selection),
                range: selection
            };
        } else {
            const text = editor.document.getText();
            const start = new vscode.Position(0, 0);
            const end = new vscode.Position(
                editor.document.lineCount - 1,
                editor.document.lineAt(editor.document.lineCount - 1).text.length
            );
            return {
                text,
                range: new vscode.Range(start, end)
            };
        }
    }

    // Helper: Replace text in the given range
    private async replaceText(editor: TextEditor, range: vscode.Range, newText: string) {
        await editor.edit(editBuilder => {
            editBuilder.replace(range, newText);
        });
    }

    // Encodes the current selection or the whole document to base64, wraps at 76 chars per line, and replaces it
    Base64Encode = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const { text, range } = this.getSelectedTextAndRange(editor);

        const encoded = Buffer.from(text, 'utf-8').toString('base64');
        const wrapped = encoded.replace(/(.{76})/g, '$1\n');

        await this.replaceText(editor, range, wrapped);
    };

    // Decodes the current selection or the whole document from base64, supports proper padding, and replaces it
    Base64Decode = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const { text, range } = this.getSelectedTextAndRange(editor);

        // Remove all whitespace and newlines
        let base64 = text.replace(/\s+/g, '');
        // Pad with '=' to make length a multiple of 4
        if (base64.length % 4 !== 0) {
            base64 = base64.padEnd(base64.length + (4 - (base64.length % 4)), '=');
        }
        let decoded = '';
        try {
            decoded = Buffer.from(base64, 'base64').toString('utf-8');
        } catch (e) {
            return;
        }

        await this.replaceText(editor, range, decoded);
    };

    // Encodes the current selection or the whole document to hex and replaces it
    HexEncode = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const { text, range } = this.getSelectedTextAndRange(editor);

        const encoded = Buffer.from(text, 'utf-8').toString('hex');

        await this.replaceText(editor, range, encoded);
    };

    // Decodes the current selection or the whole document from hex and replaces it
    HexDecode = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const { text, range } = this.getSelectedTextAndRange(editor);

        // Remove all whitespace and newlines
        let hex = text.replace(/\s+/g, '');
        let decoded = '';
        try {
            decoded = Buffer.from(hex, 'hex').toString('utf-8');
        } catch (e) {
            return;
        }

        await this.replaceText(editor, range, decoded);
    };

    // Encodes the current selection or the whole document as a URL component and replaces it
    URLEncode = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const { text, range } = this.getSelectedTextAndRange(editor);

        let encoded = '';
        try {
            encoded = encodeURIComponent(text);
        } catch (e) {
            return;
        }
        await this.replaceText(editor, range, encoded);
    };

    // Decodes the current selection or the whole document from a URL component and replaces it
    URLDecode = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const { text, range } = this.getSelectedTextAndRange(editor);

        let decoded = '';
        try {
            decoded = decodeURIComponent(text);
        } catch (e) {
            return;
        }

        await this.replaceText(editor, range, decoded);
    };

    // Inserts a random UUID in the format ['{UUID}'] at the current cursor position
    GenerateUUID = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        // Generate a random UUID v4
        function uuidv4() {
            return 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/[x]/g, function(c) {
                const r = Math.random() * 16 | 0;
                return r.toString(16).toUpperCase();
            });
        }
        const uuid = uuidv4();
        const formatted = `[\'{${uuid}}\']`;
        const position = editor.selection.active;
        await editor.edit(editBuilder => {
            editBuilder.insert(position, formatted);
        });
    };

    // Decodes the current selection or the whole document from quoted-printable encoding (UTF-8 safe) and replaces it
    QuotedPrintableDecode = async (textEditor: TextEditor, edit: TextEditorEdit) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const { text, range } = this.getSelectedTextAndRange(editor);

        // Remove soft line breaks (= or =\r\n)
        let qp = text.replace(/=\r?\n/g, '');
        // Convert to byte array
        let bytes: number[] = [];
        let i = 0;
        while (i < qp.length) {
            if (qp[i] === '=' && i + 2 < qp.length && /[A-Fa-f0-9]{2}/.test(qp.substr(i + 1, 2))) {
                bytes.push(parseInt(qp.substr(i + 1, 2), 16));
                i += 3;
            } else {
                bytes.push(qp.charCodeAt(i));
                i++;
            }
        }
        let decoded = Buffer.from(bytes).toString('utf-8');

        await this.replaceText(editor, range, decoded);
    };

}