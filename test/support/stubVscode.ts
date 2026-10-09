/**
 * Makes `require('vscode')` load ./vscode.ts. Import this before any module
 * that imports `vscode`.
 */

import Module = require('module');

const stubPath = require.resolve('./vscode');
const loader = Module as unknown as {
	_resolveFilename: (request: string, ...rest: unknown[]) => string;
};
const originalResolve = loader._resolveFilename;

loader._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]): string {
	if (request === 'vscode') {
		return stubPath;
	}
	return originalResolve.call(this, request, ...rest);
};
