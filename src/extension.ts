import type { ExtensionContext } from "vscode";
import DirectoryFileFileSystemProvider from "./DirectoryFileFileSystemProvider";
import ViewDirectoryAsFileCommand from "./ViewDirectoryAsFileCommand";

export function activate (context: ExtensionContext) {
	DirectoryFileFileSystemProvider.register(context);
	// DirectoryFileContentProvider.register(context);
	ViewDirectoryAsFileCommand.register(context);
}

export function deactivate () { }
