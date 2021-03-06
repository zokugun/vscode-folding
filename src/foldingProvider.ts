import { basename } from 'path';
import { escape, parse, translate, visit, Flavor, Token, TokenType } from '@daiyam/regexp';
import { commands, FoldingRange, FoldingRangeKind, FoldingRangeProvider, OutputChannel, ProviderResult, TextDocument, window } from 'vscode';
import { ExplicitFoldingConfig } from '@zokugun/vscode.explicit-folding-api';

interface EndMatch {
	index: number;
	regex: string;
}
type EndMatcher = (escape: (value: string) => string, offset: number, ...args: string[]) => string;
type EndMatches = { [index: number]: EndMatch[] }

enum Marker {
	BEGIN,
	MIDDLE,
	END,
	DOCSTRING,
	SEPARATOR,
	WHILE
}

interface GroupContext {
	index: number;
}

interface PreviousRegion {
	begin: number;
	end: number;
	indent: number;
}

interface Position {
	line: number;
	offset: number;
}

type Rule = {
	index: number,
	begin?: RegExp,
	middle?: RegExp,
	end?: RegExp,
	loopRegex?: RegExp,
	while?: RegExp,
	continuation?: boolean,
	consumeEnd?: (offset?: number, ...args: string[]) => boolean,
	foldLastLine: (offset?: number, ...args: string[]) => boolean,
	foldBOF: boolean,
	foldEOF: boolean,
	nested: boolean,
	kind: FoldingRangeKind,
	endMatcher?: EndMatcher,
	parents?: number[],
	strict?: boolean,
	name?: string
	autoFold?: boolean
}

type StackItem = {
	rule: Rule,
	line: number,
	separator?: boolean,
	continuation?: number
	endIndex?: number
}

const Tab = 9;
const Space = 32;

function computeIndentLevel(line: string, tabSize: number): number { // {{{
	let indent = 0;
	let i = 0;
	let len = line.length;

	while (i < len) {
		const chCode = line.charCodeAt(i);

		if (chCode === Space) {
			indent++;
		} else if (chCode === Tab) {
			indent = indent - indent % tabSize + tabSize;
		} else {
			break;
		}

		i++;
	}

	if (i === len) {
		return -1; // line only consists of whitespace
	}

	return indent;
} // }}}

function id<T>(value: T): () => T { // {{{
	return () => value;
} // }}}

function shouldFoldLastLine(foldLastLine: boolean[], groupIndex: number, endGroupCount: number): (offset?: number, ...args: string[]) => boolean { // {{{
	return (offset, ...args) => {
		for (let i = groupIndex + 1, l = groupIndex + endGroupCount; i < l; ++i) {
			if (typeof args[i + offset!] !== 'undefined') {
				return foldLastLine[i - groupIndex];
			}
		}

		return foldLastLine[0];
	}
} // }}}

export class FoldingProvider implements FoldingRangeProvider {
	private autoFoldDocuments: TextDocument[];
	private debugChannel: OutputChannel | null = null;
	private mainRegex: RegExp;
	private offSideIndentation: boolean = false;
	private rules: Array<Rule> = [];
	private useIndentation: boolean = false;

	public id: string = 'explicit';
	public isManagingLastLine: boolean = true;

	constructor(configuration: Array<ExplicitFoldingConfig>, debugChannel: OutputChannel | null, documents: TextDocument[]) { // {{{
		this.debugChannel = debugChannel;
		this.autoFoldDocuments = documents;

		const groupContext = { index: 0 };

		let source = '';

		for (const value of configuration) {
			const src = this.addRegex(value, groupContext, true, []);

			if (src.length !== 0) {
				if (source.length !== 0) {
					source += '|';
				}

				source += src;
			}
		}

		if (source.length === 0) {
			this.mainRegex = new RegExp('a^');
		} else {
			this.mainRegex = new RegExp(source, 'g');
		}
	} // }}}

	private addRegex(configuration: ExplicitFoldingConfig, groupContext: GroupContext, strict: boolean, parents: number[]): string { // {{{
		const ruleIndex = this.rules.length;

		try {
			let begin
			if (configuration.beginRegex) {
				begin = new RegExp(translate(configuration.beginRegex, Flavor.ES2018) as string);

				if (configuration.beginRegex === configuration.endRegex) {
					return this.addDocstringRegex(configuration, ruleIndex, begin, groupContext);
				}
			} else if (configuration.begin) {
				begin = new RegExp(escape(configuration.begin));

				if (configuration.begin === configuration.end) {
					return this.addDocstringRegex(configuration, ruleIndex, begin, groupContext);
				}
			}

			if (begin) {
				let end, continuation, whileRegex

				if (configuration.endRegex) {
					end = new RegExp(translate(configuration.endRegex, Flavor.ES2018) as string);
				} else if (configuration.end) {
					end = new RegExp(escape(configuration.end));
				} else if (configuration.continuationRegex) {
					continuation = new RegExp(`${translate(configuration.continuationRegex, Flavor.ES2018)}$`);
				} else if (configuration.continuation) {
					continuation = new RegExp(`${escape(configuration.continuation)}$`);
				} else if (configuration.whileRegex) {
					whileRegex = new RegExp(translate(configuration.whileRegex, Flavor.ES2018) as string);
				} else if (configuration.while) {
					whileRegex = new RegExp(escape(configuration.while));
				}

				if (end) {
					let middle

					if (configuration.middleRegex) {
						middle = new RegExp(translate(configuration.middleRegex, Flavor.ES2018) as string)
					} else if (configuration.middle) {
						middle = new RegExp(escape(configuration.middle))
					}

					return this.addBeginEndRegex(configuration, ruleIndex, begin, middle, end, groupContext, strict, parents);
				} else if (continuation) {
					return this.addContinuationRegex(configuration, ruleIndex, begin, continuation, groupContext);
				} else if (whileRegex) {
					return this.addBeginWhileRegex(configuration, ruleIndex, begin, whileRegex, groupContext);
				}
			} else if (configuration.whileRegex) {
				const whileRegex = new RegExp(translate(configuration.whileRegex, Flavor.ES2018) as string);

				return this.addWhileRegex(configuration, ruleIndex, whileRegex, groupContext);
			} else if (configuration.while) {
				const whileRegex = new RegExp(escape(configuration.while));

				return this.addWhileRegex(configuration, ruleIndex, whileRegex, groupContext);
			} else if (configuration.separatorRegex) {
				const separator = new RegExp(translate(configuration.separatorRegex, Flavor.ES2018) as string);

				return this.addSeparatorRegex(configuration, ruleIndex, separator, groupContext, strict, parents);
			} else if (configuration.separator) {
				const separator = new RegExp(escape(configuration.separator));

				return this.addSeparatorRegex(configuration, ruleIndex, separator, groupContext, strict, parents);
			} else if (configuration.indentation) {
				this.useIndentation = configuration.indentation;
				this.offSideIndentation = configuration.offSide || false;
			}
		} catch (err) {
			console.log(err)
			if (this.debugChannel) {
				this.debugChannel.appendLine(err.toString());
			}
		}

		return '';
	} // }}}

	private addBeginEndRegex(configuration: ExplicitFoldingConfig, ruleIndex: number, begin: RegExp, middle: RegExp | undefined, end: RegExp, groupContext: GroupContext, strict: boolean, parents: number[]): string { // {{{
		if (begin.test('') || end.test('')) {
			return '';
		}

		if (middle && middle.test('')) {
			return '';
		}

		const groups = this.listCaptureGroups(begin.source)

		let endMatcher;
		if (groups.length !== 0) {
			let index = groupContext.index + 1;
			let captures = configuration.endRegex!.split(/\\(\d+)/g);

			if (captures.length > 0) {
				const last = captures.length - 1;

				let src = '""';

				for (let i = 0; i <= last; i += 2) {
					if (i === last) {
						if (captures[i].length !== 0) {
							src += ' + "' + escape(captures[i]).replace(/"/g, '\\"') + '"';
						}
					} else {
						src += ' + "' + escape(captures[i]).replace(/"/g, '\\"') + '" + escape(args[' + (++index) + ' + offset])';
					}
				}

				endMatcher = eval('(function(){return function(escape, offset, ...args) { return ' + src + ';};})()') as EndMatcher;
			}
		}

		const nested = typeof configuration.nested === 'boolean' ? configuration.nested : !Array.isArray(configuration.nested);

		const rule: Rule = {
			index: ruleIndex,
			begin,
			middle,
			end,
			consumeEnd: typeof configuration.consumeEnd === 'boolean' ? id(configuration.consumeEnd) : id(true),
			foldLastLine: typeof configuration.foldLastLine === 'boolean' ? id(configuration.foldLastLine) : id(true),
			foldBOF: false,
			foldEOF: configuration.foldEOF || false,
			nested,
			strict: typeof configuration.strict === 'boolean' ? configuration.strict : configuration.strict === 'never' ? false : strict,
			kind: configuration.kind === 'comment' ? FoldingRangeKind.Comment : FoldingRangeKind.Region,
			autoFold: configuration.autoFold || false,
			endMatcher
		};

		this.rules.push(rule);

		let src = `(?<_${Marker.BEGIN}_${ruleIndex}>${rule.begin!.source})`;

		groupContext.index += 1 + this.getCaptureGroupCount(begin.source);

		const middleGroupCount = rule.middle ? 1 + this.getCaptureGroupCount(middle!.source) : 0;
		const endGroupCount = 1 + this.getCaptureGroupCount(end.source);

		if (Array.isArray(configuration.consumeEnd) && configuration.consumeEnd.length === endGroupCount) {
			const consumeEnd = configuration.consumeEnd;
			const groupIndex = 1 + (nested ? groupContext.index : 0) + middleGroupCount;

			rule.consumeEnd = shouldFoldLastLine(consumeEnd, groupIndex, endGroupCount)
		}

		if (Array.isArray(configuration.foldLastLine) && configuration.foldLastLine.length === endGroupCount) {
			const foldLastLine = configuration.foldLastLine;
			const groupIndex = 1 + (nested ? groupContext.index : 0) + middleGroupCount;

			rule.foldLastLine = shouldFoldLastLine(foldLastLine, groupIndex, endGroupCount)
		}

		if (nested) {
			if (rule.middle) {
				src += `|(?<_${Marker.MIDDLE}_${ruleIndex}>${rule.middle.source})`;

				groupContext.index += middleGroupCount;
			}

			if(!endMatcher) {
				src += `|(?<_${Marker.END}_${ruleIndex}>${rule.end!.source})`;

				groupContext.index += endGroupCount;
			}
		} else {
			rule.name = configuration.name ?? `loop=${ruleIndex}`;

			if (Array.isArray(configuration.nested)) {
				const strictParent = configuration.strict === 'never' ? false : strict;
				if (!strictParent) {
					const regexes = configuration.nested.map((config) => this.addRegex(config, groupContext, false, [...parents, ruleIndex])).filter((regex) => regex.length !== 0);

					src += `|${regexes.join('|')}`;
				}

				const regexes = configuration.nested.map((config) => this.addRegex(config, { index: 1 }, strictParent, [...parents, ruleIndex])).filter((regex) => regex.length !== 0);

				let loopSource = '';

				if (rule.middle) {
					loopSource += `(?<_${Marker.MIDDLE}_${ruleIndex}>${rule.middle.source})`;
				}

				if(!endMatcher) {
					if(loopSource) loopSource += '|';
					loopSource += `(?<_${Marker.END}_${ruleIndex}>${rule.end!.source})`;
				}

				if(loopSource) loopSource += '|';
				loopSource += regexes.join('|');

				rule.loopRegex = new RegExp(loopSource, 'g');
			} else {
				let loopSource = '';

				if (rule.middle) {
					loopSource += `(?<_${Marker.MIDDLE}_${ruleIndex}>${rule.middle.source})`;
				}

				if(!endMatcher) {
					if(loopSource) loopSource += '|';
					loopSource += `(?<_${Marker.END}_${ruleIndex}>${rule.end!.source})`;
				}

				rule.loopRegex = new RegExp(loopSource || 'a^', 'g');
			}
		}

		return src;
	} // }}}

	private addBeginWhileRegex(configuration: ExplicitFoldingConfig, ruleIndex: number, begin: RegExp, whileRegex: RegExp, groupContext: GroupContext): string { // {{{
		if (begin.test('') || whileRegex.test('')) {
			return '';
		}

		groupContext.index += 1 + this.getCaptureGroupCount(begin.source);

		const rule = {
			index: ruleIndex,
			begin,
			while: whileRegex,
			foldLastLine: typeof configuration.foldLastLine === 'boolean' ? id(configuration.foldLastLine) : id(true),
			foldBOF: false,
			foldEOF: configuration.foldEOF || false,
			nested: false,
			kind: configuration.kind === 'comment' ? FoldingRangeKind.Comment : FoldingRangeKind.Region,
			autoFold: configuration.autoFold || false
		};

		this.rules.push(rule);

		return `(?<_${Marker.BEGIN}_${ruleIndex}>${rule.begin.source})`;
	} // }}}

	private addContinuationRegex(configuration: ExplicitFoldingConfig, ruleIndex: number, begin: RegExp, whileRegex: RegExp, groupContext: GroupContext): string { // {{{
		if (begin.test('') || whileRegex.test('')) {
			return '';
		}

		groupContext.index += 1 + this.getCaptureGroupCount(begin.source);

		const rule = {
			index: ruleIndex,
			begin,
			while: whileRegex,
			continuation: true,
			foldLastLine: typeof configuration.foldLastLine === 'boolean' ? id(configuration.foldLastLine) : id(true),
			foldBOF: false,
			foldEOF: configuration.foldEOF || false,
			nested: false,
			kind: configuration.kind === 'comment' ? FoldingRangeKind.Comment : FoldingRangeKind.Region,
			autoFold: configuration.autoFold || false
		};

		this.rules.push(rule);

		return `(?<_${Marker.BEGIN}_${ruleIndex}>${rule.begin.source})`;
	} // }}}

	private addDocstringRegex(configuration: ExplicitFoldingConfig, ruleIndex: number, begin: RegExp, groupContext: GroupContext): string { // {{{
		if (begin.test('')) {
			return '';
		}

		groupContext.index += 1 + this.getCaptureGroupCount(begin.source);

		const rule = {
			index: ruleIndex,
			begin,
			foldLastLine: typeof configuration.foldLastLine === 'boolean' ? id(configuration.foldLastLine) : id(true),
			foldBOF: false,
			foldEOF: configuration.foldEOF || false,
			nested: typeof configuration.nested === 'boolean' ? configuration.nested : true,
			kind: configuration.kind === 'comment' ? FoldingRangeKind.Comment : FoldingRangeKind.Region,
			autoFold: configuration.autoFold || false
		};

		this.rules.push(rule);

		return `(?<_${Marker.DOCSTRING}_${ruleIndex}>${rule.begin.source})`;
	} // }}}

	private addSeparatorRegex(configuration: ExplicitFoldingConfig, ruleIndex: number, separator: RegExp, groupContext: GroupContext, strict: boolean, parents: number[]): string { // {{{
		if (separator.test('')) {
			return '';
		}

		groupContext.index += 1 + this.getCaptureGroupCount(separator.source);

		const rule = {
			index: ruleIndex,
			begin: separator,
			foldLastLine: id(false),
			foldBOF: typeof configuration.foldBOF === 'boolean' ? configuration.foldBOF : true,
			foldEOF: typeof configuration.foldEOF === 'boolean' ? configuration.foldEOF : true,
			nested: typeof configuration.nested === 'boolean' ? configuration.nested : true,
			strict: typeof configuration.strict === 'boolean' ? configuration.strict : configuration.strict === 'never' ? false : strict,
			kind: configuration.kind === 'comment' ? FoldingRangeKind.Comment : FoldingRangeKind.Region,
			autoFold: configuration.autoFold || false,
			parents
		};

		this.rules.push(rule);

		const nested = configuration.descendants || (Array.isArray(configuration.nested) ? configuration.nested : null)

		if (nested) {
			const regexes = nested.map((config) => this.addRegex(config, groupContext, configuration.strict === 'never' ? false : strict, [...parents, ruleIndex])).filter((regex) => regex.length !== 0);

			return `(?<_${Marker.SEPARATOR}_${ruleIndex}>${rule.begin.source})|${regexes.join('|')}`;
		} else {
			return `(?<_${Marker.SEPARATOR}_${ruleIndex}>${rule.begin.source})`;
		}
	} // }}}

	private addWhileRegex(configuration: ExplicitFoldingConfig, ruleIndex: number, whileRegex: RegExp, groupContext: GroupContext): string { // {{{
		if (whileRegex.test('')) {
			return '';
		}

		groupContext.index += 1 + this.getCaptureGroupCount(whileRegex.source);

		const rule = {
			index: ruleIndex,
			while: whileRegex,
			foldLastLine: typeof configuration.foldLastLine === 'boolean' ? id(configuration.foldLastLine) : id(true),
			foldBOF: false,
			foldEOF: configuration.foldEOF || false,
			nested: false,
			kind: configuration.kind === 'comment' ? FoldingRangeKind.Comment : FoldingRangeKind.Region,
			autoFold: configuration.autoFold || false
		};

		this.rules.push(rule);

		return `(?<_${Marker.WHILE}_${ruleIndex}>${rule.while.source})`;
	} // }}}

	private doEOF(document: TextDocument, foldingRanges: FoldingRange[], stack: StackItem[], foldLines: number[]): void { // {{{
		const end = document.lineCount;
		while (stack[0]) {
			if (stack[0].rule.foldEOF) {
				const begin = stack[0].line;

				if (end > begin + 1) {
					this.pushNewRange(stack[0].rule, begin, end - 1, foldingRanges, foldLines);
				}
			}

			stack.shift();
		}
	} // }}}

	private doWhile(document: TextDocument, foldingRanges: FoldingRange[], rule: Rule, line: number, continuation: boolean, foldLines: number[]): Position { // {{{
		const begin = line;

		while (++line < document.lineCount) {
			const text = document.lineAt(line).text;

			if (!rule.while!.test(text)) {
				const end = line - (continuation ? 0 : 1);

				if (rule.foldLastLine()) {
					if (end > begin) {
						this.pushNewRange(rule, begin, end, foldingRanges, foldLines);
					}

					return { line: end + 1, offset: 0 };
				} else {
					if (end > begin + 1) {
						this.pushNewRange(rule, begin, end - 1, foldingRanges, foldLines);
					}

					return { line: end, offset: 0 };
				}
			}
		}

		const end = Math.min(line, document.lineCount - 1);

		if (rule.foldLastLine()) {
			if (end > begin) {
				this.pushNewRange(rule, begin, end, foldingRanges, foldLines);
			}
		} else {
			if (end > begin + 1) {
				this.pushNewRange(rule, begin, end - 1, foldingRanges, foldLines);
			}
		}


		return { line: line, offset: 0 };
	} // }}}

	private *findOfRegexp(regex: RegExp, line: string, offset: number) { // {{{
		// reset regex
		regex.lastIndex = offset;

		while (true) {
			const match = regex.exec(line) as { groups?: { [key: string]: string }, index?: number, [key: number]: string };

			if (match && match.groups) {
				if (match[0].length === 0) {
					break;
				}

				const index = match.index || 0;
				if (index < offset) {
					continue;
				}

				const nextOffset = index + match[0].length;

				for (const key in match.groups) {
					if (match.groups[key]) {
						const keys = key.split('_').map(x => parseInt(x));

						yield {
							type: keys[1],
							index: keys[2],
							match: (match as string[]),
							nextOffset
						};

						break;
					}
				}
			} else {
				break;
			}
		}
	} // }}}

	private getCaptureGroupCount(regex: string): number { // {{{
		const ast = parse(regex);

		let count = 0;

		visit(ast.body, {
			[TokenType.CAPTURE_GROUP]() {
				++count;
			}
		});

		return count;
	} // }}}

	private listCaptureGroups(regex: string): Token[] { // {{{
		const ast = parse(regex);

		const groups: Token[] = [];

		visit(ast.body, {
			[TokenType.CAPTURE_GROUP](token) {
				groups.push(token);
			}
		});

		return groups;
	} // }}}

	public provideFoldingRanges(document: TextDocument): ProviderResult<FoldingRange[]> { // {{{
		if (this.debugChannel) {
			this.debugChannel.show(true);

			this.debugChannel.appendLine(`[document] lang: ${document.languageId}, fileName: ${basename(document.fileName)}`);
			this.debugChannel.appendLine(`[main] regex: ${this.mainRegex.toString()}`);
		}

		const foldingRanges: FoldingRange[] = [];
		const foldLines: number[] = [];

		const stack: StackItem[] = [];
		const endMatches = {};

		let position: Position = { line: 0, offset: 0 };

		try{
			while (position.line < document.lineCount) {
				position = this.resolveExplicitRange(document, foldingRanges, 'main', this.mainRegex, stack, endMatches, 0, false, position.line, position.offset, foldLines);
			}

			this.doEOF(document, foldingRanges, stack, foldLines);

			if (this.useIndentation) {
				this.resolveIndentationRange(document, foldingRanges);
			}
		}
		catch(ex) {
			if (this.debugChannel) {
				this.debugChannel.appendLine(ex);
			}
		}

		if (this.debugChannel) {
			this.debugChannel.appendLine(`[document] foldings: ${JSON.stringify(foldingRanges)}`);
		}

		const index = this.autoFoldDocuments.indexOf(document);
		if (index !== -1) {
			this.autoFoldDocuments.splice(index, 1);

			if (foldLines.length !== 0) {
				commands.executeCommand('editor.fold', {
					levels: 1,
					selectionLines: foldLines,
				});
			}
		}

		return foldingRanges;
	} // }}}

	private pushNewRange(rule: Rule, begin: number, end: number, foldingRanges: FoldingRange[], foldLines: number[]): void { // {{{
		foldingRanges.push(new FoldingRange(begin, end, rule.kind));

		if (rule.autoFold) {
			foldLines.push(begin);
		}
	} // }}}

	private resolveExplicitRange(document: TextDocument, foldingRanges: FoldingRange[], name: String, regexp: RegExp, stack: StackItem[], endMatches: EndMatches, matchOffset: number, secondaryLoop: boolean, line: number, offset: number, foldLines: number[]): Position { // {{{
		const text = document.lineAt(line).text;

		for (const { type, index, match, nextOffset } of this.findOfRegexp(regexp, text, offset)) {
			const rule = this.rules[index];

			if (this.debugChannel) {
				this.debugChannel.appendLine(`[${name}] line: ${line + 1}, offset: ${offset}, type: ${Marker[type]}, match: ${match[0]}, regex: ${index}`);
			}

			switch (type) {
				case Marker.BEGIN:
					if (!stack[0] || stack[0].rule.nested) {
						if (rule.endMatcher) {
							let endMatch;
							if(endMatches[rule.index]) {
								endMatch = endMatches[rule.index];
							}
							else {
								endMatch = endMatches[rule.index] = [];
							}

							const end = rule.endMatcher(escape, matchOffset, ...match);

							let nf = true;
							let endIndex = endMatch.length + 1;
							for(const match of endMatch) {
								if(end === match.regex) {
									endIndex = match.index;
									nf = false;
								}
							}

							let loopRegex;
							if(nf) {
								endMatch.push({
									regex: end,
									index: endIndex
								});

								loopRegex = new RegExp(`(?<_${Marker.END}_${index}_${endIndex}>${end})|` + regexp.source, 'g');

								++matchOffset;
							}
							else {
								loopRegex = regexp;
							}

							const loopStack: StackItem[] = [{ rule, line, endIndex }];

							let position = this.resolveExplicitRange(document, foldingRanges, name, loopRegex, loopStack, endMatches, matchOffset, true, line, nextOffset, foldLines);

							while (loopStack.length != 0 && position.line < document.lineCount) {
								position = this.resolveExplicitRange(document, foldingRanges, name, loopRegex, loopStack, endMatches, matchOffset, true, position.line, position.offset, foldLines);
							}

							if(nf) {
								const index = endMatch.findIndex(({ index }) => index === endIndex);
								endMatch.splice(index, 1);
							}

							return position;
						} else if (!rule.nested && rule.end) {
							const loopRegex = rule.loopRegex!;
							const name = rule.name!;

							if (this.debugChannel) {
								this.debugChannel.appendLine(`[${name}] regex: ${loopRegex.toString()}`);
							}

							const stack: StackItem[] = [{ rule, line }];

							let position = this.resolveExplicitRange(document, foldingRanges, name, loopRegex, stack, {}, 0, true, line, nextOffset, foldLines);

							while (stack.length != 0 && position.line < document.lineCount) {
								position = this.resolveExplicitRange(document, foldingRanges, name, loopRegex, stack, {}, 0, true, position.line, position.offset, foldLines);
							}

							if (stack.length != 0 && position.line >= document.lineCount) {
								this.doEOF(document, foldingRanges, stack, foldLines);
							}

							return position;
						} else if (rule.continuation) {
							if (!rule.while!.test(text)) {
								return { line: line + 1, offset: 0 };
							}

							return this.doWhile(document, foldingRanges, rule, line, true, foldLines);
						} else if (rule.while) {
							return this.doWhile(document, foldingRanges, rule, line, false, foldLines);
						} else {
							stack.unshift({ rule, line });
						}
					}
					break;
				case Marker.MIDDLE:
					if (stack[0] && stack[0].rule === rule) {
						const begin = stack[0].line;
						const end = line;

						if (end > begin + 1) {
							this.pushNewRange(rule, begin, end - 1, foldingRanges, foldLines);
						}

						stack[0].line = line;
					}
					break;
				case Marker.END:
					const last = stack.length && stack[stack.length - 1];
					if (secondaryLoop && last && last.rule === rule) {
						if(last.endIndex) {
							// @ts-ignore
							if(!match.groups[`_${Marker.END}_${rule.index}_${last.endIndex}`]) {
								stack.pop();

								return { line, offset };
							}
						}

						const begin = last.line;
						const end = rule.consumeEnd!() ? line : Math.max(line - 1, begin);

						while (stack.length > 1) {
							const begin = stack[0].line;

							if (end > begin + 1) {
								this.pushNewRange(stack[0].rule, begin, end - 1, foldingRanges, foldLines);
							}

							stack.shift();
						}

						stack.shift();

						if (rule.foldLastLine()) {
							if (end > begin) {
								this.pushNewRange(rule, begin, end, foldingRanges, foldLines);
							}
						} else {
							if (end > begin + 1) {
								this.pushNewRange(rule, begin, end - 1, foldingRanges, foldLines);
							}
						}

						return { line: end, offset: nextOffset };
					} else if (stack[0] && stack[0].rule === rule) {
						const begin = stack[0].line;
						const end = rule.consumeEnd!() ? line : Math.max(line - 1, begin);

						if (rule.foldLastLine(matchOffset, ...match)) {
							if (end > begin) {
								this.pushNewRange(rule, begin, end, foldingRanges, foldLines);
							}
						} else {
							if (end > begin + 1) {
								this.pushNewRange(rule, begin, end - 1, foldingRanges, foldLines);
							}
						}

						stack.shift();
					}
					break;
				case Marker.DOCSTRING:
					if (stack[0] && stack[0].rule === rule) {
						const begin = stack[0].line;
						const end = line;

						if (rule.foldLastLine()) {
							if (end > begin) {
								this.pushNewRange(rule, begin, end, foldingRanges, foldLines);
							}
						} else {
							if (end > begin + 1) {
								this.pushNewRange(rule, begin, end - 1, foldingRanges, foldLines);
							}
						}

						stack.shift();
					} else if (!stack[0] || stack[0].rule.nested) {
						stack.unshift({ rule, line });
					}
					break;
				case Marker.SEPARATOR:
					if (!stack[0]) {
						if (rule.foldBOF) {
							if (line > 1) {
								this.pushNewRange(rule, 0, line - 1, foldingRanges, foldLines);
							}

							stack.unshift({ rule, line, separator: true });
						} else if (!rule.parents || !rule.parents.length) {
							stack.unshift({ rule, line, separator: true });
						}
					} else {
						while (stack.length && stack[0].rule.parents && stack[0].rule.parents!.includes(index)) {
							const begin = stack.shift()!.line;
							const end = line;

							if (end > begin + 1) {
								this.pushNewRange(rule, begin, end - 1, foldingRanges, foldLines);
							}
						}

						if (!stack.length) {
							if (!rule.parents || !rule.parents.length) {
								stack.unshift({ rule, line, separator: true });
							}
						} else if (stack[0].rule === rule) {
							const begin = stack[0].line;
							const end = line;

							if (end > begin + 1) {
								this.pushNewRange(rule, begin, end - 1, foldingRanges, foldLines);
							}

							stack[0].line = line;
						} else if (stack[0].rule.nested || (secondaryLoop && stack.length === 1)) {
							if (!rule.parents || !rule.parents.length) {
								stack.unshift({ rule, line, separator: true });
							} else {
								const parent = rule.parents![rule.parents!.length - 1];

								if (this.rules[parent].strict) {
									if (stack.some(({ rule: { index } }) => parent === index)) {
										stack.unshift({ rule, line, separator: true });
									}
								} else if (stack.some(({ rule: { index } }) => rule.parents!.includes(index))) {
									stack.unshift({ rule, line, separator: true });
								}
							}
						}
					}
					break;
				case Marker.WHILE:
					return this.doWhile(document, foldingRanges, rule, line, false, foldLines);
			}
		}

		return { line: line + 1, offset: 0 };
	} // }}}

	private resolveIndentationRange(document: TextDocument, foldingRanges: FoldingRange[]): void { // {{{
		const tabSize = window.activeTextEditor ? parseInt(`${window.activeTextEditor.options.tabSize || 4}`) : 4;

		const existingRanges: { [key: string]: boolean } = {}
		for (const range of foldingRanges) {
			existingRanges[range.start] = true
		}

		const previousRegions: PreviousRegion[] = [{ indent: -1, begin: document.lineCount, end: document.lineCount }];

		for (let line = document.lineCount - 1; line >= 0; line--) {
			const lineContent = document.lineAt(line).text;
			const indent = computeIndentLevel(lineContent, tabSize);

			let previous = previousRegions[previousRegions.length - 1];

			if (indent === -1) {
				if (this.offSideIndentation) {
					// for offSide languages, empty lines are associated to the previous block
					// note: the next block is already written to the results, so this only
					// impacts the end position of the block before
					previous.end = line;
				}
				continue; // only whitespace
			}

			if (previous.indent > indent) {
				// discard all regions with larger indent
				do {
					previousRegions.pop();
					previous = previousRegions[previousRegions.length - 1];
				} while (previous.indent > indent);

				// new folding range
				let endLineNumber = previous.end - 1;
				if (endLineNumber - line >= 1) { // needs at east size 1
					if (!existingRanges[line]) {
						foldingRanges.push(new FoldingRange(line, endLineNumber, FoldingRangeKind.Region));
					}
				}
			}

			if (previous.indent === indent) {
				previous.end = line;
			} else { // previous.indent < indent
				// new region with a bigger indent
				previousRegions.push({ indent, begin: line, end: line });
			}
		}
	} // }}}
}
