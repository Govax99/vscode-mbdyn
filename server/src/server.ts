/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	// documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'languageServerExample'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// In this simple example we get the settings for every validate run.
	const settings = await getDocumentSettings(textDocument.uri);

	// The validator creates diagnostics for all const variables redefined
	const text = textDocument.getText();
	const lines : string[] = text.split(/\r?\n/g);
	// extract defined variables (e.g. "set: a = 1;" or "set: a;") and put them in a map with the variable name as key and value as index in lines
	const definedVariables : string[] = [];
	lines.forEach((line, index) => {
		if (line.includes("set:") && line.includes("const") && line.includes(";")) {
			let variable = line.split("=")[0];
			// remove only const word
			variable = variable.replace("const", "");
			// remove all whitespaces
			variable = variable.replace(/\s/g, "\\s*");
			// push variable only if it is not empty
			definedVariables.push(variable);
		}
	});

	let pattern_str = "";
	definedVariables.forEach((variable, index) => {
		pattern_str += variable + "|";
	});
	pattern_str = pattern_str.slice(0, -1);
	pattern_str = "(" + pattern_str + ")";
	const pattern = new RegExp(pattern_str, "g");



	//const pattern = /\b[A-Z]{2,}\b/g;
	let m: RegExpExecArray | null;

	const diagnostics: Diagnostic[] = [];

	let problems = 0;
	if (definedVariables.length > 0) {
		while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
			problems++;
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				range: {
					start: textDocument.positionAt(m.index),
					end: textDocument.positionAt(m.index + m[0].length)
				},
				message: `${m[0]} is a const variable, it cannot be redefined.`,
				source: 'ex'
			};
			/*if (hasDiagnosticRelatedInformationCapability) {
				diagnostic.relatedInformation = [
					{
						location: {
							uri: textDocument.uri,
							range: Object.assign({}, diagnostic.range)
						},
						message: 'Spelling matters'
					},
					{
						location: {
							uri: textDocument.uri,
							range: Object.assign({}, diagnostic.range)
						},
						message: 'Particularly for names'
					}
				];
			}*/
			diagnostics.push(diagnostic);
		}
	}


	
	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		// The pass parameter contains the position of the text document in
		// which code complete got requested. For the example we ignore this
		// info and always provide the same completion items.
		return [
			{ label: 'begin:', kind: CompletionItemKind.Text, data: 1 },
			{ label: 'end:', kind: CompletionItemKind.Text, data: 1 },
			{ label: 'set:', kind: CompletionItemKind.Text, data: 1 },
			{ label: 'include:', kind: CompletionItemKind.Text, data: 1 },
			{ label: 'bool', kind: CompletionItemKind.Text, data: 2 },
			{ label: 'integer', kind: CompletionItemKind.Text, data: 2 },
			{ label: 'real', kind: CompletionItemKind.Text, data: 2 },
			{ label: 'string', kind: CompletionItemKind.Text, data: 2 },
			{ label: 'reference', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'derivatives', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'coefficient', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'modified', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'tolerance', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'iterations', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'newton raphson', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'crank nicolson', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'position', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'orientation', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'rotation', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'constraint', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'proportional', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'viscoelastic', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'dynamic', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'static', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'hydraulic', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'direction', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'compressible', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'incompressible', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'fluid', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'skip initial joint assembly', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'residual', kind: CompletionItemKind.Text, data: 3 },
			{ label: 'ifndef', kind: CompletionItemKind.Text, data: 4 },
			{ label: 'const', kind: CompletionItemKind.Text, data: 5 },
			{ label: 'Time', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'TimeStep', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'Step', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'Var', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'e', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'pi', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'FALSE', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'TRUE', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'INT_MAX', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'INT_MIN', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'RAND_MAX', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'REAL_MAX', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'REAL_MIN', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'in2m', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'm2in', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'in2mm', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'mm2in', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'ft2m', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'm2ft', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'lb2kg', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'kg2lb', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'deg2rad', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'rad2deg', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'slug2kg', kind: CompletionItemKind.Text, data: 6 },
			{ label: 'abs', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'acos', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'acosh', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'actan', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'actan2', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'actanh', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'asinh', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'atanh', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'asin', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'atan', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'atan2', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'ceil', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'copysign', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'cos', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'cosh', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'ctan', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'ctanh', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'exp', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'floor', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'in_ee', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'in_el', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'in_le', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'in_ll', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'log', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'log10', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'max', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'min', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'par', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'print', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'ramp', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'rand', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'random', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'round', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'seed', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'sign', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'sin', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'sinh', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'sprintf', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'sqrt', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'sramp', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'step', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'stop', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'tan', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'tanh', kind: CompletionItemKind.Function, data: 7 },
			{ label: 'constitutive law:', kind: CompletionItemKind.Text, data: 8 },
			{ label: 'c81 data:', kind: CompletionItemKind.Text, data: 8 },
			{ label: 'drive caller:', kind: CompletionItemKind.Text, data: 8 },
			{ label: 'hydraulic fluid:', kind: CompletionItemKind.Text, data: 8 },
			{ label: 'include:', kind: CompletionItemKind.Text, data: 8 },
			{ label: 'module load:', kind: CompletionItemKind.Text, data: 8 },
			//{ label: 'print symbol table:', kind: CompletionItemKind.Text, data: 8 },
			{ label: 'reference:', kind: CompletionItemKind.Text, data: 8 },
			{ label: 'direct', kind: CompletionItemKind.Text, data: 9 },
			{ label: 'time', kind: CompletionItemKind.Text, data: 9 },
			{ label: 'timestep', kind: CompletionItemKind.Text, data: 9 },
			{ label: 'unit', kind: CompletionItemKind.Text, data: 9 },
		];
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		switch (item.data) {
			case 1: item.detail = 'Statement';
				switch (item.label) {
					case 'begin:': item.documentation = 'Begin block of code'; break;
					case 'end:': item.documentation = 'End block of code'; break;
					case 'set': item.documentation = item.documentation = [ "Set variable value for the rest of the text file.", "Example:", "set: type name = value" ].join("\n"); break;
					case 'reference:': item.documentation = 'Begin reference definition'; break;
					case 'include:': item.documentation = 'Include statement. Allows to include the contents of file_name into the current input file.'; break;
				} break;
			case 2: item.detail = 'Built-in type'; item.documentation = [ "Specify variable type.", "Example:", "set: <type> name = value" ].join("\n"); break;
			case 3: item.detail = 'Miscellaneous keywords';
				switch (item.label) {
					case 'reference': item.documentation = 'Explicit reference to element'; break;
					default: item.documentation = ''; break;
				} break;
			case 4: item.detail = 'Declaration modifier'; item.documentation = [ "The ifndef modifier prevents the declaration from being overwritten if it has already been declared.", "Example:", "ifndef: type name = value" ].join("\n"); break;
			case 5: item.detail = 'Type modifier'; item.documentation = [ "The const modifier prevents the declaration from being overwritten.", "Example:", "const: type name = value" ].join("\n"); break;
			case 6: item.detail = 'Built-in variable'; 
				switch (item.label) {
					case 'Time': item.documentation = 'Current simulation time'; break;
					case 'TimeStep': item.documentation = 'Current simulation time step'; break;
					case 'Step': item.documentation = 'Current simulation step'; break;
					case 'Var': item.documentation = 'Set by dof, node, or element drive callers with degree of freedom value, node or element private data value, respectively'; break;
					case 'e': item.documentation = "Neper’s number"; break;
					case 'pi': item.documentation = 'Pi constant'; break;
					case 'FALSE': item.documentation = 'Bool false constant'; break;
					case 'TRUE': item.documentation = 'Bool true constant'; break;
					case 'INT_MAX': item.documentation = 'Largest integer'; break;
					case 'INT_MIN': item.documentation = 'Smallest integer'; break;
					case 'RAND_MAX': item.documentation = 'Largest random integer'; break;
					case 'REAL_MAX': item.documentation = 'Largest real'; break;
					case 'REAL_MIN': item.documentation = 'Smallest real'; break;
					case 'in2m': item.documentation = 'Inch to meter ratio (0.0254)'; break;
					case 'm2in': item.documentation = 'Meter to inch ratio (1.0/0.0254)'; break;
					case 'in2mm': item.documentation = 'Inch to meter ratio (25.4)'; break;
					case 'mm2in': item.documentation = 'Meter to inch ratio (1.0/25.4)'; break;
					case 'ft2m': item.documentation = 'Foot to meter ratio (0.3048)'; break;
					case 'm2ft': item.documentation = 'Meter to foot ratio (1.0/0.3048)'; break;
					case 'lb2kg': item.documentation = 'Pound to kilogram ratio (0.45359237)'; break;
					case 'kg2lb': item.documentation = 'Kilogram to pound ratio (1.0/0.45359237)'; break;
					case 'deg2rad': item.documentation = 'Degree to radian ratio (π/180)'; break;
					case 'rad2deg': item.documentation = 'Radian to degree ratio (180/π)'; break;
					case 'slug2kg': item.documentation = ' Slug to kilogram ratio (14.5939)'; break;
					case 'kg2slug': item.documentation = 'Kilogram to slug ratio (1.0/14.5939)'; break;

					
				} break;
			case 7: item.detail = 'Built-in function';
				switch (item.label) {
					case 'abs': item.documentation = 'absolute value'; break;
					case 'acos': item.documentation = 'arc cosine'; break;
					case 'acosh': item.documentation = 'hyperbolic arc cosine'; break;
					case 'actan': item.documentation = 'arc co-tangent'; break;
					case 'actan2': item.documentation = '(robust) arc co-tangent of y/x'; break;
					case 'actanh': item.documentation = 'hyperbolic arc co-tangent'; break;
					case 'asinh': item.documentation = 'hyperbolic arc sine'; break;
					case 'atanh': item.documentation = 'hyperbolic arc tangent'; break;
					case 'asin': item.documentation = 'arc sine'; break;
					case 'atan': item.documentation = 'arc tangent'; break;
					case 'atan2': item.documentation = '(robust) arc tangent of y/x'; break;
					case 'ceil': item.documentation = 'closest integer from above'; break;
					case 'copysign': item.documentation = 'ﬁrst arg with sign of second'; break;
					case 'cos': item.documentation = 'cosine'; break;
					case 'cosh': item.documentation = 'hyperbolic cosine'; break;
					case 'ctan': item.documentation = 'co-tangent'; break;
					case 'ctanh': item.documentation = 'hyperbolic co-tangent'; break;
					case 'exp': item.documentation = 'exponential'; break;
					case 'floor': item.documentation = 'closest integer from below'; break;
					case 'in_ee': item.documentation = 'true when arg1 ≤ arg2 ≤ arg3, false otherwise'; break;
					case 'in_el': item.documentation = 'true when arg1 ≤ arg2 < arg3, false otherwise'; break;
					case 'in_le': item.documentation = 'true when arg1 < arg2 ≤ arg3, false otherwise'; break;
					case 'in_ll': item.documentation = 'true when arg1 < arg2 < arg3, false otherwise'; break;
					case 'log': item.documentation = 'natural logarithm'; break;
					case 'log10': item.documentation = 'base 10 logarithm'; break;
					case 'max': item.documentation = 'returns the smallest of the two inputs'; break;
					case 'min': item.documentation = 'returns the largest of the two inputs'; break;
					case 'par': item.documentation = 'parabolic function'; break;
					case 'print': item.documentation = 'prints a value to standard output'; break;
					case 'ramp': item.documentation = 'ramp function'; break;
					case 'rand': item.documentation = 'random integer [0, RAND MAX]'; break;
					case 'random': item.documentation = 'random real [-1.0, 1.0]'; break;
					case 'round': item.documentation = 'closest integer'; break;
					case 'seed': item.documentation = 'seeds the random number generator'; break;
					case 'sign': item.documentation = 'sign of a number'; break;
					case 'sin': item.documentation = 'sine'; break;
					case 'sinh': item.documentation = 'hyperbolic sine'; break;
					case 'sprintf': item.documentation = ['returns a string with value formatted according to format (string, any) -> string', 'Examples:', 'sprintf("%04d", 9); -> "0009"', 'sprintf("0x%x", 255); -> Print an integer in hexadecimal format'].join("\n"); break;
					case 'sqrt': item.documentation = 'square root'; break;
					case 'sramp': item.documentation = 'saturated ramp function'; break;
					case 'step': item.documentation = 'step function'; break;
					case 'stop': item.documentation = 'stops and returns second arg if first is true (bool, integer) -> integer'; break;
					case 'tan': item.documentation = 'tangent'; break;
					case 'tanh': item.documentation = 'hyperbolic tangent'; break;
				} break;
			case 8: item.detail = 'Directive';
				switch (item.label) {
					case 'constitutive law:': item.documentation = ['Constitutive laws are grouped by their dimensionality dim, which (up to now) can be any of 1, 3 and 6.'].join("\n"); break;
					case 'c81 data:': item.documentation = ['This keyword allows to deﬁne and read the c81 dataairfoil tables that are used by aerodynamic elements.'].join("\n"); break;
					case 'drive caller:': item.documentation = ['Allows to deﬁne a drive caller that can be subsequently reused. It is useful essentially in two cases:','a) to deﬁne a drive that will be used many times throughout a model;', ' to deﬁne a drive that needs to be used in a later deﬁned part of a model, in order to make it parametric.'].join("\n"); break;
					case 'hydraulic fluid:': item.documentation = ['Allows to deﬁne a hydraulic fluid to be later used in hydraulic elements'].join("\n"); break;
					case 'include:': item.documentation = ['Allows to include the contents of the file file_name, which must be a valid ﬁlename for the operating', 'system in use. The ﬁle name must be enclosed in double quotes ("). The full (absolute or relative) path', 'must be given if the included ﬁle is not in the directory of the including one.'].join("\n"); break;
					case 'print symbol table:': item.documentation = ['allows to print to standard output the contents of the parser’s symbol table at any stage of the input', 'phase. This may be useful for model debugging purposes.'].join("\n"); break;
					case 'reference:': item.documentation = ['A reference system is declared and deﬁned.'].join("\n"); break;
				} break;
				case 9: item.detail = 'Drive';
				switch (item.label) {
					case 'direct': item.documentation = 'Direct drive caller. Transparently returns the input value. The arglist is empty'; break;
					case 'time': item.documentation = 'Yields the current time. The arglist is empty'; break;
					case 'timestep': item.documentation = 'Yields the current timestep. The arglist is empty'; break;
					case 'unit': item.documentation = 'Always 1. The arglist is empty'; break;
				} break;
			default: break;
		}
		return item;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
