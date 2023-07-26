import path = require("path");
import { Uri } from "vscode";

namespace DirectoryFileScheme {

	export const SCHEME = "directoryfile";
	export const EXT = ". (Directory)"

	let seq = 0;

	export function encodeToDirectoryFileUri (uri: Uri): Uri {
		return Uri.parse(`${SCHEME}:${encodeURIComponent(uri.path)}${EXT}#${seq++}`);
	}

	export function decodeToDirectoryUri (uri: Uri): Uri {
		return Uri.parse(`file:${decodeURIComponent(uri.path).slice(0, -EXT.length)}`);
	}
}

export default DirectoryFileScheme;
