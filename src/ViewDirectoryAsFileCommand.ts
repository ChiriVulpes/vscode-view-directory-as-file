import type { ExtensionContext, Uri } from "vscode";
import { commands, window, workspace } from "vscode";
import DirectoryFileScheme from "./DirectoryFileScheme";

async function ViewDirectoryAsFileCommand (directoryUri: Uri) {
	const directoryFileUri = DirectoryFileScheme.encodeToDirectoryFileUri(directoryUri);
	const document = await Promise.resolve(workspace.openTextDocument(directoryFileUri))
		.catch(err => console.error(err));

	if (document)
		await window.showTextDocument(document, { preview: false });
}

namespace ViewDirectoryAsFileCommand {
	export function register (context: ExtensionContext) {
		const providerRegistration = commands.registerCommand("view-directory-as-file.viewDirectoryAsFile", ViewDirectoryAsFileCommand);
		context.subscriptions.push(providerRegistration);
	}
}

export default ViewDirectoryAsFileCommand;
