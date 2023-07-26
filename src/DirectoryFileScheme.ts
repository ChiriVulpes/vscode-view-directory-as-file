import { Uri } from "vscode";

namespace DirectoryFileScheme {

	export const SCHEME = "directoryfile";

	let seq = 0;

	export function encodeToDirectoryFileUri (uri: Uri): Uri {
		return Uri.parse(`${SCHEME}:${encodeURIComponent(uri.path)}#${seq++}`);
	}

	export function decodeToDirectoryUri (uri: Uri): Uri {
		return Uri.parse(`file:${decodeURIComponent(uri.path)}`);
	}
}

export default DirectoryFileScheme;
