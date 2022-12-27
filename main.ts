import { App, Editor, MarkdownView, EditorPosition, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

function getCurrentLine(editor: Editor, view: MarkdownView) {
	const lineNumber = editor.getCursor().line
	const lineText = editor.getLine(lineNumber)
	return lineText
}

interface TodoInfo {
	title: string,
	tags: string,
	date: string
}

interface PluginSettings {
	defaultTags: string
}

const DEFAULT_SETTINGS: PluginSettings = {
	defaultTags: ''
}

function urlEncode(line: string) {
	line = encodeURIComponent(line)
	return line
}

function contructTodo(line: string, settings: PluginSettings, fileName: string){
	line = line.trim();
	const tags = extractTags(line, settings.defaultTags);

	line = line.replace(/#([^\s]+)/gs, '');

	const todo: TodoInfo = {
		title: extractTitle(line),
		tags: tags,
		date: extractDate(fileName)
	}

	return todo;
}

function extractDate(line:string) {
	const regex = /^(19|20)\d\d([- /.])(0[1-9]|1[012])\2(0[1-9]|[12][0-9]|3[01])/
	let date = '';
	const res = line.match(regex);
	if (res) {
    date = res[0];
  }
	return date;
}

function extractTitle(line: string) {
	const regex = /[^#\s\-\[\]*](.*)/gs
	const content = line.match(regex);
	let title = '';
	if (content != null) {
		title = content[0]
	}

	return title;
}

function extractTags(line: string, setting_tags: string){
	const regex = /#([^\s]+)/gs
	const array = [...line.matchAll(regex)]
	const tag_array = array.map(x => x[1])
	if (setting_tags.length > 0) {
		tag_array.push(setting_tags);
	}
	line = line.replace(regex, '');
	const tags = tag_array.join(',')

	return tags;
}

function extractTarget(line: string) {
	const regexId = /task\/(\w+)/
	const id = line.match(regexId);
	let todoId: string;
	if (id != null) {
		todoId = id[1];
	} else {
		todoId = ''
	}

	const regexStatus = /\[(.)\]/
	const status = line.match(regexStatus)
	let afterStatus: string;
	if (status && status[1] == ' ') {
		afterStatus = 'markComplete'
	} else {
		afterStatus = 'markIncomplete'
	}

	return  {todoId, afterStatus}
}

function createTodo(todo: TodoInfo, deepLink: string){
	const url = `omnifocus://x-callback-url/paste?target=inbox&content=-%20${todo.title}%20%40defer%28${todo.date}%29%20%40tags%28${todo.tags}%29%0A${deepLink}&x-success=obsidian://of-sync-id`;
	window.open(url);
}

function updateTodo(todoId: string, completed: string){
	const url = `omnifocus://localhost/omnijs-run?script=Task.byIdentifier%28argument%29.${completed}%28%29&arg=%22${todoId}%22`;
	window.open(url);
}

export default class OFPlugin extends Plugin {
	settings: PluginSettings;

	async onload() {

		// Setup Settings Tab
		await this.loadSettings();
		this.addSettingTab(new OFSyncSettingTab(this.app, this));

		// Register Protocol Handler
		this.registerObsidianProtocolHandler("of-sync-id", async (id) => {
			const todoID = id['result'];
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view == null) {
				return;
			} else {
				const editor = view.editor
				const currentLine = getCurrentLine(editor, view)
				const firstLetterIndex = currentLine.search(/[^\s#\-\[\]*]/);
				const line = currentLine.substring(firstLetterIndex, currentLine.length)
				const editorPosition = view.editor.getCursor()
				const lineLength = view.editor.getLine(editorPosition.line).length
				const startRange: EditorPosition = {
					line: editorPosition.line,
					ch: firstLetterIndex
				}
				const endRange: EditorPosition = {
					line: editorPosition.line,
					ch: lineLength
				}

				if (firstLetterIndex > 0) {
					view.editor.replaceRange(`[${line}](${todoID})`, startRange, endRange);
				} else {
					view.editor.replaceRange(`- [ ] [${line}](${todoID})`, startRange, endRange);
				}
			}
		});

		// Create TODO Command
		this.addCommand({
			id: 'create-of-todo',
			name: 'Create Omnifocus Todo',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const workspace = this.app.workspace;
				const fileTitle = workspace.getActiveFile()
				if (fileTitle == null) {
					return;
				} else {
					let fileName = urlEncode(fileTitle.name)
					fileName = fileName.replace(/\.md$/, '')
					const obsidianDeepLink = (this.app as any).getObsidianUrl(fileTitle)
					const encodedLink = urlEncode(obsidianDeepLink)
					const line = getCurrentLine(editor, view)
					const todo = contructTodo(line, this.settings, fileName)
					createTodo(todo, encodedLink)
				}
			}
		});

		// Toggle task status and sync to things
		this.addCommand({
			id: 'toggle-of-todo',
			name: 'Toggle Omnifocus Todo',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const workspace = this.app.workspace;
				const fileTitle = workspace.getActiveFile()
				if (fileTitle == null) {
					return;
				} else {
					const line = getCurrentLine(editor, view)
					const target = extractTarget(line)
					if (target.todoId == '') {
						new Notice(`This is not an Omnifocus todo`);
					} else {
						view.app.commands.executeCommandById("editor:toggle-checklist-status")
						updateTodo(target.todoId, target.afterStatus)
						new Notice(`${target.todoId} set completed:${target.afterStatus} on omnifocus`);
					}

				}
			}
		});
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class OFSyncSettingTab extends PluginSettingTab {
	plugin: OFPlugin;

	constructor(app: App, plugin: OFPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
		containerEl.createEl('h2', {text: 'Settings for Obsidian Omnifocus Sync.'});

		new Setting(containerEl)
			.setName('Default Tags')
			.setDesc('The default tags for Obsidian Todo; Using comma(,) \
			to separate multiple tags; Leave this blank for no default tags')
			.addText(text => text
				.setPlaceholder('Leave your tags here')
				.setValue(this.plugin.settings.defaultTags)
				.onChange(async (value) => {
					this.plugin.settings.defaultTags = value;
					await this.plugin.saveSettings();
				}));
	}
}
