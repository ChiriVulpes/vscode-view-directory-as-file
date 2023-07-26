import { CancellationToken, CodeLens, CodeLensProvider, ExtensionContext, ProviderResult, TextDocument, languages } from "vscode";
import DirectoryFileScheme from "./DirectoryFileScheme";

export default class DirectoryFileCodeLensProvider implements CodeLensProvider {
	public static register (context: ExtensionContext) {
		const provider = new DirectoryFileCodeLensProvider();
		const providerRegistration = languages.registerCodeLensProvider({ scheme: DirectoryFileScheme.SCHEME }, provider);
		context.subscriptions.push(providerRegistration);
	}

	public provideCodeLenses (document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]> {
		return [];
	}
}
