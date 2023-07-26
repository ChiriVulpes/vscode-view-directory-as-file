import type { ExtensionContext, FileChangeEvent, FileSystemProvider, FileSystemWatcher, RelativePattern, Uri } from "vscode";
import { Disposable, EventEmitter, FileChangeType, FileType, TabInputText, window, workspace } from "vscode";
import DirectoryFileScheme from "./DirectoryFileScheme";
import path = require("path");

export default class DirectoryFileFileSystemProvider implements FileSystemProvider {

	public static register (context: ExtensionContext) {
		const provider = new DirectoryFileFileSystemProvider(context);
		const providerRegistration = workspace.registerFileSystemProvider(DirectoryFileScheme.SCHEME, provider, { isCaseSensitive: true });
		context.subscriptions.push(providerRegistration);
	}

	private constructor (context: ExtensionContext) {
		const watchRelevantFiles = this.watchRelevantFiles.bind(this);
		context.subscriptions.push(window.tabGroups.onDidChangeTabGroups(watchRelevantFiles));
		context.subscriptions.push(window.onDidChangeVisibleTextEditors(watchRelevantFiles));
	}

	public async stat (uri: Uri) {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		const result = await workspace.fs.stat(realUri);
		const tracked = this.trackedDirectoryFiles.get(uri.path);
		result.type = FileType.File;
		result.mtime = tracked?.mtime || result.mtime;
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
			new TextEncoder().encode(`Viewing directory as file: ${relative(workspaceFolderPath, realUri.path)}\n`),
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
			.then(files => files
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([file]) => uri.with({ path: path.join(uri.fsPath, file) })))
			.then(uris => Promise.all(uris
				.map(async uri => ({ uri, data: await this.readFileOrDirectoryAsCombinedFile(uri, root) }))))
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
		return this.addWatchReason(uri);
	}

	public delete (uri: Uri, options: { readonly recursive: boolean; }): void | Thenable<void> {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		return workspace.fs.delete(realUri, options);
	}

	public createDirectory (uri: Uri): void | Thenable<void> {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		return workspace.fs.createDirectory(realUri);
	}

	private emitter = new EventEmitter<FileChangeEvent[]>();
	public onDidChangeFile = this.emitter.event;

	private trackedDirectoryFiles = new Map<string, {
		mtime: number,
		watcher: FileSystemWatcher,
		reasons: Set<number>,
	}>();

	private watchRelevantFiles () {
		const openTabs = window.tabGroups.all
			.flatMap(group => group.tabs)
			.filter(tab => tab.input instanceof TabInputText && tab.input.uri.path.endsWith(DirectoryFileScheme.EXT));

		// todo set tab labels when vscode finally supports that

		const openFiles = openTabs.map(tab => (tab.input as TabInputText).uri);

		for (const file of openFiles)
			this.addWatchReason(file, -1);

		const openFileKeys = new Set(openFiles.map(file => file.path));
		// console.log("visible files:", ...openFileKeys);
		for (const path of [...this.trackedDirectoryFiles.keys()])
			if (!openFileKeys.has(path))
				this.removeWatchReason(path, -1);
	}

	private watchId = 0;

	private addWatchReason (uri: Uri, id = this.watchId++) {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);

		let managedWatcher = this.trackedDirectoryFiles.get(uri.path);
		if (!managedWatcher) {

			const relativePath = path.relative(workspace.getWorkspaceFolder(realUri)?.uri.path ?? "/", realUri.path);

			const glob = path.join(relativePath, "**/*").replace(REGEX_SLASH, "/");

			const fileWatcher = workspace.createFileSystemWatcher("**/*");
			// console.log("create file watcher", glob);

			fileWatcher.onDidCreate(this.createFileChangeHandler(uri, FileChangeType.Created));
			fileWatcher.onDidChange(this.createFileChangeHandler(uri, FileChangeType.Changed));
			fileWatcher.onDidDelete(this.createFileChangeHandler(uri, FileChangeType.Deleted));

			this.trackedDirectoryFiles.set(uri.path, managedWatcher = {
				mtime: 0,
				watcher: fileWatcher,
				reasons: new Set(),
			});
		}

		managedWatcher.reasons.add(id);

		return new Disposable(() => this.removeWatchReason(uri.path, id));
	}

	private removeWatchReason (path: string, id: number) {
		const managedWatcher = this.trackedDirectoryFiles.get(path);
		managedWatcher!.reasons.delete(id);
		if (!managedWatcher!.reasons.size) {
			// console.log("dispose file watcher", path);
			managedWatcher!.watcher.dispose();
			this.trackedDirectoryFiles.delete(path);
		}
	}

	private createFileChangeHandler (uri: Uri, type: FileChangeType, excludes?: RelativePattern[]) {
		const realUri = DirectoryFileScheme.decodeToDirectoryUri(uri);
		return (changedFileUri: Uri) => {
			if (changedFileUri.path.startsWith(realUri.path)) {
				// console.log("file changed", changedFileUri.path, "updating", uri.path);
				const tracked = this.trackedDirectoryFiles.get(uri.path);
				if (tracked)
					tracked.mtime = Date.now();

				this.emitter.fire([{ uri, type }]);
			}
		};
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
