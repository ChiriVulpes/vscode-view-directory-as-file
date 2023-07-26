import type { ExtensionContext, FileChangeEvent, FileSystemProvider, FileSystemWatcher, Uri } from "vscode";
import { Disposable, EventEmitter, FileChangeType, FileType, RelativePattern, workspace } from "vscode";
import DirectoryFileScheme from "./DirectoryFileScheme";
import path = require("path");

export default class DirectoryFileFileSystemProvider implements FileSystemProvider {

	public static register (context: ExtensionContext) {
		const provider = new DirectoryFileFileSystemProvider();
		const providerRegistration = workspace.registerFileSystemProvider(DirectoryFileScheme.SCHEME, provider, { isCaseSensitive: true });
		context.subscriptions.push(providerRegistration);
	}

	private emitter = new EventEmitter<FileChangeEvent[]>();
	public onDidChangeFile = this.emitter.event;

	private watchers = new Map<string, FileSystemWatcher>();

	public async stat (uri: Uri) {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		const result = await workspace.fs.stat(realUri);
		result.type = FileType.File;
		return result;
	}

	public async readDirectory (uri: Uri) {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		return await workspace.fs.readDirectory(realUri);
	}

	public async readFile (uri: Uri) {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		const workspaceFolderPath = workspace.getWorkspaceFolder(realUri)?.uri.path ?? workspace.rootPath ?? "/";
		return mergeUint8Arrays([
			new TextEncoder().encode(`Viewing directory as file: ${relative(workspaceFolderPath, uri.path)}\n`),
			await this.readFileOrDirectoryAsCombinedFile(realUri, realUri),
		]);
	}

	private async readFileOrDirectoryAsCombinedFile (uri: Uri, root: Uri): Promise<Uint8Array> {
		const file = await Promise.resolve(workspace.fs.readFile(uri))
			.catch(err => undefined);

		if (file) {
			const encoder = new TextEncoder();
			return mergeUint8Arrays([
				encoder.encode(`\n===== ${relative(root.path, uri.path)} =====\n`),
				file,
			]);
		}

		const decoder = new TextDecoder("utf8");

		return file ?? Promise.resolve(workspace.fs.readDirectory(uri))
			.catch(() => [])
			.then(files => files.map(([file]) => uri.with({ path: path.join(uri.fsPath, file) })))
			.then(uris => Promise.all(uris.map(async uri => ({ uri, data: await this.readFileOrDirectoryAsCombinedFile(uri, root) }))))
			.then(files => mergeUint8Arrays(files.map(file => file.data)));
	}

	public writeFile (uri: Uri, content: Uint8Array) {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		return workspace.fs.writeFile(realUri, content);
	}

	public rename (oldUri: Uri, newUri: Uri, options: { readonly overwrite: boolean; }): void | Thenable<void> {
		const realOldUri = DirectoryFileScheme.decodeToDirectoryUri(oldUri);
		const realNewUri = DirectoryFileScheme.decodeToDirectoryUri(newUri);
		return workspace.fs.rename(realOldUri, realNewUri, options);
	}

	public watch (uri: Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[]; }): Disposable {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);

		// Create a glob pattern for the provided URI, based on the options
		const globPattern = new RelativePattern(realUri.fsPath, "**/*");

		// Create the file system watcher
		const fileWatcher = workspace.createFileSystemWatcher(globPattern, options.recursive, false, false);

		if (options.excludes.length)
			throw new Error("Cannot use `excludes` as vscode does not expose glob support");

		// Add event listeners for the file system watcher
		fileWatcher.onDidCreate(this.createFileChangeHandler(FileChangeType.Created));
		fileWatcher.onDidChange(this.createFileChangeHandler(FileChangeType.Changed));
		fileWatcher.onDidDelete(this.createFileChangeHandler(FileChangeType.Deleted));

		// Store the watcher in the map for future disposal if needed
		this.watchers.set(uri.fsPath, fileWatcher);

		// Return a disposable object to unregister the watcher when necessary
		return Disposable.from(fileWatcher, {
			dispose: () => {
				fileWatcher.dispose();
				this.watchers.delete(uri.fsPath);
			},
		});
	}

	private createFileChangeHandler (type: FileChangeType, excludes?: RelativePattern[]) {
		return (uri: Uri) => {
			this.emitter.fire([{ uri, type }]);
		};
	}

	public delete (uri: Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		return workspace.fs.delete(realUri, options);
	}

	public createDirectory (uri: Uri): void | Thenable<void> {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		return workspace.fs.createDirectory(realUri);
	}
}

const REGEX_SLASH = /\\/g;
function relative (from: string, to: string) {
	return path.relative(from, to).replace(REGEX_SLASH, "/");
}

function mergeUint8Arrays (arrays: Uint8Array[]) {
	const result = new Uint8Array(arrays.reduce((totalLength, array) => totalLength + array.length, 0));
	let i = 0;

	for (const array of arrays) {
		result.set(array, i);
		i += array.length;
	}
	return result;
}
